/**
 * PROTOTYPE, throwaway. Lives only on the `prototype-webchannel-spike` branch.
 *
 * Question: what does the transport from `webchannel-channel.demo.ts` look
 * like written directly as a `Channel` with `Channel.fromTransform`, without
 * the stream function and the adapter? Everything below the transport (schemas,
 * demo) is the same as in that file.
 *
 * Needs a Firestore emulator on 127.0.0.1:8080 (`vp run emulator`), then:
 *
 *   vpx packages/client/prototypes/webchannel-direct.demo.ts
 *
 * The wire protocol is described in `webchannel.demo.ts`.
 */
import {
  Cause,
  Channel,
  ChannelSchema,
  Console,
  Effect,
  Pull,
  Queue,
  Schema,
  Scope,
  Stream,
  type Array as Arr,
} from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

// ---------------------------------------------------------------------------
// Transport: Channel.fromTransform
// ---------------------------------------------------------------------------

class TransportError extends Schema.TaggedError<TransportError>()("TransportError", {
  cause: Schema.Defect(),
}) {}

interface WebChannelOptions {
  readonly url: string;
  readonly urlParams: Record<string, string>;
  readonly initHeaders: Record<string, string>;
}

/** Splits `<len>\n<json>` frames out of response text, across network chunks. */
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
          const length = Number(buffer.slice(0, newline));
          if (buffer.length < newline + 1 + length) break;
          out.push(JSON.parse(buffer.slice(newline + 1, newline + 1 + length)));
          buffer = buffer.slice(newline + 1 + length);
        }
        return [buffer, out] as const;
      },
    ),
    Stream.flattenIterable,
  );

const log = (line: string) => Console.log(`  \x1b[2m[webchannel] ${line}\x1b[0m`);

/**
 * One WebChannel session per run of the channel: the handshake runs when the
 * channel starts, `terminate` when its scope closes. Two fibers in that scope
 * do the work: one pulls requests from upstream and POSTs each chunk, the other
 * reads the back channel into a bounded queue that downstream pulls from. The
 * session stays open after the requests end, because WebChannel has no
 * half-close; the consumer ends it.
 */
const webChannel = <IE = never>(
  options: WebChannelOptions,
): Channel.Channel<
  Arr.NonEmptyReadonlyArray<unknown>,
  TransportError | IE,
  void,
  Arr.NonEmptyReadonlyArray<unknown>,
  IE,
  unknown,
  HttpClient.HttpClient
> =>
  Channel.fromTransform(
    Effect.fnUntraced(
      function* (
        upstream: Pull.Pull<Arr.NonEmptyReadonlyArray<unknown>, IE, unknown>,
        scope: Scope.Scope,
      ) {
        const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
        let rid = Math.floor(Math.random() * 100_000);
        let aid = 0;
        let ofs = 0;
        let sid = "";
        let gsessionid: string | undefined;

        const request = (method: "GET" | "POST", params: Record<string, string>) =>
          HttpClientRequest.make(method)(options.url).pipe(
            HttpClientRequest.setUrlParams({
              VER: "8",
              ...options.urlParams,
              ...(sid ? { SID: sid } : {}),
              ...(gsessionid ? { gsessionid } : {}),
              ...params,
              zx: Math.random().toString(36).slice(2, 14),
              t: "1",
            }),
          );
        const toTransportError = <A, R>(self: Effect.Effect<A, unknown, R>) =>
          Effect.mapError(self, (error) =>
            error instanceof TransportError ? error : new TransportError({ cause: error }),
          );

        // Handshake
        const handshake = yield* http.execute(
          request("POST", {
            RID: String(rid++),
            CVER: "22",
            "X-HTTP-Session-Id": "gsessionid",
          }).pipe(
            HttpClientRequest.bodyUrlParams({
              headers: Object.entries(options.initHeaders)
                .map(([k, v]) => `${k}:${v}\r\n`)
                .join(""),
              count: "0",
            }),
          ),
        );
        const [[, [tag, newSid]]] = yield* handshake.stream.pipe(
          Stream.decodeText(),
          frames,
          Stream.runCollect,
        );
        if (tag !== "c" || typeof newSid !== "string") {
          return yield* new TransportError({
            cause: new Error(`Unexpected handshake: ${String(tag)}`),
          });
        }
        sid = newSid;
        gsessionid = handshake.headers["x-http-session-id"];
        yield* log(`handshake  SID=${sid}`);

        // Added before the fibers are forked, so it runs after they are interrupted.
        // `Scope.addFinalizer` takes an Effect value, so suspend it: the RID
        // must be read when the finalizer runs, not when it is added.
        yield* Scope.addFinalizer(
          scope,
          Effect.suspend(() =>
            log(`terminate  GET  RID=${rid}`).pipe(
              Effect.andThen(
                http.execute(request("GET", { RID: String(rid++), TYPE: "terminate" })),
              ),
            ),
          ).pipe(Effect.timeout("2 seconds"), Effect.ignore),
        );

        // Bounded, so the back channel stops reading while downstream is slow.
        const output = yield* Queue.bounded<unknown, TransportError | IE | Cause.Done>(64);

        // Back channel: one GET at a time, reopened with the latest AID when
        // the server ends it.
        yield* Effect.gen(function* () {
          yield* log(`back       GET  AID=${aid}`);
          const response = yield* http.execute(
            request("GET", { RID: "rpc", AID: String(aid), CI: "0", TYPE: "xmlhttp" }),
          );
          yield* response.stream.pipe(
            Stream.decodeText(),
            frames,
            Stream.runForEach(([id, [message]]) => {
              aid = id;
              if (message === "noop") return Effect.void;
              if (message === "stop" || message === "close") {
                return Effect.fail(
                  new TransportError({ cause: new Error(`Server sent ${message}`) }),
                );
              }
              return Queue.offer(output, message);
            }),
          );
        }).pipe(
          Effect.forever,
          toTransportError,
          Effect.catch((error) => Queue.fail(output, error)),
          Effect.forkIn(scope),
        );

        // Forward channel: each chunk pulled from upstream becomes one POST.
        const send = (batch: Arr.NonEmptyReadonlyArray<unknown>) =>
          Effect.gen(function* () {
            const body: Record<string, string> = {
              count: String(batch.length),
              ofs: String(ofs),
            };
            batch.forEach((m, i) => (body[`req${i}___data__`] = JSON.stringify(m)));
            yield* log(`forward    POST RID=${rid} AID=${aid} ofs=${ofs} count=${batch.length}`);
            ofs += batch.length;
            yield* http.execute(
              request("POST", { RID: String(rid++), AID: String(aid) }).pipe(
                HttpClientRequest.bodyUrlParams(body),
              ),
            );
          }).pipe(toTransportError);

        yield* upstream.pipe(
          Effect.flatMap(send),
          Effect.forever,
          // Upstream ended. Nothing to tell the server, the session stays open.
          Pull.catchDone(() => Effect.void),
          Effect.catchCause((cause) => Queue.failCause(output, cause)),
          Effect.forkIn(scope),
        );

        return Queue.takeAll(output);
      },
      Effect.catchTag("HttpClientError", (cause) => Effect.fail(new TransportError({ cause }))),
    ),
  );

// ---------------------------------------------------------------------------
// Firestore Listen, typed through ChannelSchema.duplexUnknown
// ---------------------------------------------------------------------------

const ListenRequest = Schema.Struct({
  database: Schema.String,
  addTarget: Schema.optional(
    Schema.Struct({
      targetId: Schema.Number,
      query: Schema.Struct({
        parent: Schema.String,
        structuredQuery: Schema.Struct({
          from: Schema.Array(Schema.Struct({ collectionId: Schema.String })),
        }),
      }),
    }),
  ),
  removeTarget: Schema.optional(Schema.Number),
});
type ListenRequest = typeof ListenRequest.Type;

const ListenResponse = Schema.Struct({
  targetChange: Schema.optional(
    Schema.Struct({
      targetChangeType: Schema.optional(
        Schema.Literals(["NO_CHANGE", "ADD", "REMOVE", "CURRENT", "RESET"]),
      ),
      targetIds: Schema.optional(Schema.Array(Schema.Number)),
      resumeToken: Schema.optional(Schema.String),
      readTime: Schema.optional(Schema.String),
    }),
  ),
  documentChange: Schema.optional(
    Schema.Struct({
      document: Schema.Struct({
        name: Schema.String,
        fields: Schema.Record(Schema.String, Schema.Unknown),
      }),
      targetIds: Schema.optional(Schema.Array(Schema.Number)),
    }),
  ),
});
type ListenResponse = typeof ListenResponse.Type;

const emulator = "http://127.0.0.1:8080";
const database = "projects/demo-webchannel-spike/databases/(default)";

const listen = ChannelSchema.duplexUnknown(
  webChannel({
    url: `${emulator}/google.firestore.v1.Firestore/Listen/channel`,
    urlParams: { database },
    initHeaders: {
      "google-cloud-resource-prefix": database,
      "x-goog-request-params": database,
      Authorization: "Bearer owner",
    },
  }),
  { inputSchema: ListenRequest, outputSchema: ListenResponse },
);

// ---------------------------------------------------------------------------
// Demo, driven by the responses instead of sleeps
// ---------------------------------------------------------------------------

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

const describe = (r: ListenResponse) =>
  r.targetChange
    ? `targetChange ${r.targetChange.targetChangeType ?? "(token)"} ${r.targetChange.targetIds ?? ""}`
    : r.documentChange
      ? `documentChange ${r.documentChange.document.name.split("/documents/")[1]} ${JSON.stringify(r.documentChange.document.fields)}`
      : JSON.stringify(r);

const program = Effect.gen(function* () {
  yield* writeDoc("a", 1);

  const requests = yield* Queue.unbounded<ListenRequest>();
  // Two requests queued before the stream starts, to see them batched into one POST.
  yield* Queue.offerAll(requests, [
    {
      database,
      addTarget: {
        targetId: 2,
        query: {
          parent: `${database}/documents`,
          structuredQuery: { from: [{ collectionId: "spike" }] },
        },
      },
    },
    {
      database,
      addTarget: {
        targetId: 4,
        query: {
          parent: `${database}/documents`,
          structuredQuery: { from: [{ collectionId: "other" }] },
        },
      },
    },
  ]);

  let currents = 0;
  yield* Console.log("\n-- Stream.fromQueue(requests).pipe(Stream.pipeThroughChannel(listen))");
  yield* Stream.fromQueue(requests).pipe(
    Stream.pipeThroughChannel(listen),
    Stream.tap((response) => Console.log(`<- ${describe(response)}`)),
    Stream.tap((response) =>
      Effect.gen(function* () {
        if (
          response.targetChange?.targetChangeType !== "CURRENT" ||
          !response.targetChange.targetIds?.includes(2)
        ) {
          return;
        }
        currents++;
        if (currents === 1) yield* writeDoc("b", 2);
        if (currents === 2) {
          yield* Console.log("\n-- removeTarget 2 and 4");
          yield* Queue.offerAll(requests, [
            { database, removeTarget: 2 },
            { database, removeTarget: 4 },
          ]);
        }
      }),
    ),
    Stream.takeUntil(
      (response) =>
        response.targetChange?.targetChangeType === "REMOVE" &&
        !!response.targetChange.targetIds?.includes(4),
    ),
    Stream.runDrain,
  );
  yield* Console.log("\n-- stream ended");
});

await Effect.runPromise(program.pipe(Effect.provide(FetchHttpClient.layer)));
