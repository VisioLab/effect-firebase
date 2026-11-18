/**
 * PROTOTYPE, throwaway. Lives only on the `prototype-webchannel-spike` branch.
 *
 * Question: can Google's WebChannel transport be an Effect `Socket.Socket`
 * built on nothing but `HttpClient`, and drive Firestore's `Listen` stream?
 *
 * Needs a Firestore emulator on 127.0.0.1:8080 (`vp run emulator`), then:
 *
 *   vpx packages/client/prototypes/webchannel.demo.ts
 *
 * The protocol below was recorded from `@firebase/webchannel-wrapper` talking
 * to the emulator (its `useFetchStreams` mode, with `fetch` instrumented):
 *
 *   handshake  POST ?VER=8&RID=<n>&CVER=22&X-HTTP-Session-Id=gsessionid
 *              form: headers=<k:v\r\n…>&count=0
 *              ← 52\n[[0,["c",<SID>,"",8,12,30000]]]
 *   back       GET  ?RID=rpc&SID=…&AID=<last array id>&CI=0&TYPE=xmlhttp
 *              ← <len>\n[[id,[payload]],…] … , repeated, `["noop"]` heartbeats
 *   forward    POST ?SID=…&RID=<n+1>&AID=…  form: count=k&ofs=<sent>&req0___data__=<json>…
 *              ← [1,<last array id>,<outstanding bytes>]
 *   terminate  GET  ?SID=…&RID=<n+1>&TYPE=terminate
 */
import { Console, Deferred, Effect, Queue, Scope, Semaphore, Stream } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { Socket } from "effect/socket";

// ---------------------------------------------------------------------------
// WebChannel as a Socket
// ---------------------------------------------------------------------------

interface WebChannelOptions {
  /** e.g. `http://127.0.0.1:8080/google.firestore.v1.Firestore/Listen/channel` */
  readonly url: string;
  /** Sent on every request, Firestore uses `database`. */
  readonly urlParams: Record<string, string>;
  /** Sent once, in the handshake, as the `headers` form field. */
  readonly initHeaders: Record<string, string>;
}

interface Session {
  readonly sid: string;
  /** From the `X-HTTP-Session-Id` response header. Production sends it, the emulator does not. */
  readonly gsessionid: string | undefined;
}

/** Splits `<len>\n<json>` frames out of the text of a response, across network chunks. */
const frames = <E, R>(self: Stream.Stream<string, E, R>) =>
  self.pipe(
    Stream.mapAccum(
      () => "",
      (buffer, text) => {
        buffer += text;
        const out: Array<Array<[number, Array<unknown>]>> = [];
        for (;;) {
          const newline = buffer.indexOf("\n");
          if (newline === -1) break;
          // The length counts UTF-16 code units, which is what Closure's
          // `responseText.substring` uses.
          const length = Number(buffer.slice(0, newline));
          if (buffer.length < newline + 1 + length) break;
          out.push(JSON.parse(buffer.slice(newline + 1, newline + 1 + length)));
          buffer = buffer.slice(newline + 1 + length);
        }
        return [buffer, out] as const;
      },
    ),
  );

const readError = (cause: unknown) =>
  new Socket.SocketError({ reason: new Socket.SocketReadError({ cause }) });
const writeError = (cause: unknown) =>
  new Socket.SocketError({ reason: new Socket.SocketWriteError({ cause }) });
const closed = (code: number, closeReason?: string) =>
  new Socket.SocketError({ reason: new Socket.SocketCloseError({ code, closeReason }) });

const log = (line: string) => Console.log(`  \x1b[2m[webchannel] ${line}\x1b[0m`);

export const makeWebChannel = (options: WebChannelOptions) =>
  Effect.gen(function* () {
    const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);

    // Protocol state shared by the reader and the writer.
    const session = yield* Deferred.make<Session, Socket.SocketError>();
    let rid = Math.floor(Math.random() * 100_000);
    let aid = 0; // last array id received on the back channel
    let ofs = 0; // number of messages sent on the forward channel
    const forward = yield* Semaphore.make(1);

    const request = (
      method: "GET" | "POST",
      s: Session | undefined,
      params: Record<string, string>,
    ) =>
      HttpClientRequest.make(method)(options.url).pipe(
        HttpClientRequest.setUrlParams({
          VER: "8",
          ...options.urlParams,
          ...(s ? { SID: s.sid } : {}),
          ...(s?.gsessionid ? { gsessionid: s.gsessionid } : {}),
          ...params,
          zx: Math.random().toString(36).slice(2, 14),
          t: "1",
        }),
      );

    const handshake = Effect.gen(function* () {
      const headers = Object.entries(options.initHeaders)
        .map(([k, v]) => `${k}:${v}\r\n`)
        .join("");
      const response = yield* http.execute(
        request("POST", undefined, {
          RID: String(rid++),
          CVER: "22",
          "X-HTTP-Session-Id": "gsessionid",
        }).pipe(HttpClientRequest.bodyUrlParams({ headers, count: "0" })),
      );
      const [[[, [tag, sid]]]] = yield* response.stream.pipe(
        Stream.decodeText(),
        frames,
        Stream.runCollect,
      );
      if (tag !== "c" || typeof sid !== "string") {
        return yield* Effect.die(new Error(`Unexpected handshake: ${tag}`));
      }
      const s: Session = { sid, gsessionid: response.headers["x-http-session-id"] };
      yield* log(`handshake  SID=${s.sid} gsessionid=${s.gsessionid ?? "-"}`);
      return s;
    }).pipe(
      Effect.mapError(
        (cause) =>
          new Socket.SocketError({
            reason: new Socket.SocketOpenError({ kind: "Unknown", cause }),
          }),
      ),
    );

    // One back-channel GET: streams arrays into the queue until the server
    // ends the response. The caller reopens it with the new AID.
    const backChannel = (s: Session, queue: Queue.Queue<string, Socket.SocketError>) =>
      Effect.gen(function* () {
        yield* log(`back       GET  AID=${aid}`);
        const response = yield* http.execute(
          request("GET", s, { RID: "rpc", AID: String(aid), CI: "0", TYPE: "xmlhttp" }),
        );
        yield* response.stream.pipe(
          Stream.decodeText(),
          frames,
          Stream.runForEach((arrays) =>
            Effect.forEach(arrays, ([id, payload]) => {
              aid = id;
              const [first] = payload;
              if (first === "noop") return log(`back       noop AID=${aid}`);
              if (first === "stop" || first === "close") {
                return Queue.fail(queue, closed(1000, String(first)));
              }
              // Socket frames are strings, so the already parsed message is
              // serialised again here.
              return Queue.offer(queue, JSON.stringify(first));
            }),
          ),
        );
      });

    const reader: Socket.Socket["reader"] = Effect.gen(function* () {
      const scope = yield* Effect.scope;
      const s = yield* handshake;
      yield* Deferred.succeed(session, s);
      const queue = yield* Queue.unbounded<string, Socket.SocketError>();

      yield* backChannel(s, queue).pipe(
        Effect.forever,
        Effect.catch((cause) => Queue.fail(queue, readError(cause))),
        Effect.forkIn(scope),
      );

      yield* Scope.addFinalizer(
        scope,
        Effect.gen(function* () {
          yield* Queue.fail(queue, closed(1000));
          yield* Deferred.fail(session, closed(1000));
          yield* log(`terminate  GET  RID=${rid}`);
          yield* http
            .execute(request("GET", s, { RID: String(rid++), TYPE: "terminate" }))
            .pipe(Effect.timeout("2 seconds"), Effect.ignore);
        }),
      );

      return { pull: Queue.takeAll(queue), upgrade: Socket.SocketUpgradeError.unsupported };
    });

    const send = (messages: ReadonlyArray<string>) =>
      forward.withPermits(1)(
        Effect.gen(function* () {
          const s = yield* Deferred.await(session);
          const body: Record<string, string> = { count: String(messages.length), ofs: String(ofs) };
          messages.forEach((m, i) => (body[`req${i}___data__`] = m));
          yield* log(`forward    POST RID=${rid} AID=${aid} ofs=${ofs} count=${messages.length}`);
          ofs += messages.length;
          const response = yield* http
            .execute(
              request("POST", s, { RID: String(rid++), AID: String(aid) }).pipe(
                HttpClientRequest.bodyUrlParams(body),
              ),
            )
            .pipe(Effect.mapError(writeError));
          const ack = yield* response.text.pipe(Effect.mapError(writeError));
          yield* log(`forward    ack  ${ack.replace("\n", " ")}`);
        }),
      );

    const decoder = new TextDecoder();
    const toText = (chunk: Uint8Array | string) =>
      typeof chunk === "string" ? chunk : decoder.decode(chunk);

    const writer: Socket.Socket["writer"] = Effect.succeed({
      // A CloseEvent has nothing to send over WebChannel: closing the
      // reader's scope terminates the session.
      write: (chunk) => (Socket.isCloseEvent(chunk) ? Effect.void : send([toText(chunk)])),
      writeAll: (chunks) => send(chunks.map(toText)),
    });

    return Socket.make({ reader, writer });
  });

// ---------------------------------------------------------------------------
// Demo: one Listen target against the emulator
// ---------------------------------------------------------------------------

const emulator = "http://127.0.0.1:8080";
const database = "projects/demo-webchannel-spike/databases/(default)";

const writeDoc = (id: string, n: number) =>
  Effect.gen(function* () {
    const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
    yield* Console.log(`\n-- REST: write spike/${id} n=${n}`);
    yield* http.execute(
      HttpClientRequest.patch(`${emulator}/v1/${database}/documents/spike/${id}`).pipe(
        HttpClientRequest.setHeader("Authorization", "Bearer owner"),
        HttpClientRequest.bodyJsonUnsafe({ fields: { n: { integerValue: String(n) } } }),
      ),
    );
  });

const program = Effect.gen(function* () {
  yield* writeDoc("a", 1);

  const socket = yield* makeWebChannel({
    url: `${emulator}/google.firestore.v1.Firestore/Listen/channel`,
    urlParams: { database },
    initHeaders: {
      "google-cloud-resource-prefix": database,
      "x-goog-request-params": database,
      Authorization: "Bearer owner",
    },
  });

  yield* Console.log("\n-- open the socket");
  const reader = yield* socket.reader;
  const writer = yield* socket.writer;

  yield* reader.pull.pipe(
    Effect.flatMap((batch) =>
      Effect.forEach(batch, (message) => Console.log(`<- ${String(message)}`)),
    ),
    Effect.forever,
    Effect.catch((error) => Console.log(`-- reader ended: ${error.message}`)),
    Effect.forkScoped,
  );

  yield* Console.log("\n-- addTarget spike/*");
  yield* writer.write(
    JSON.stringify({
      database,
      addTarget: {
        query: {
          parent: `${database}/documents`,
          structuredQuery: { from: [{ collectionId: "spike" }] },
        },
        targetId: 2,
      },
    }),
  );
  yield* Effect.sleep("1 second");

  yield* writeDoc("b", 2);
  yield* Effect.sleep("1 second");

  yield* Console.log("\n-- removeTarget 2");
  yield* writer.write(JSON.stringify({ database, removeTarget: 2 }));
  yield* Effect.sleep("500 millis");

  yield* Console.log("\n-- close the scope");
});

await Effect.runPromise(program.pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer)));
