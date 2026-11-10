// PROTOTYPE — throwaway, for "Can Firestore read atoms hydrate from the SDK
// snapshot JSON alone?" (#218). Never merged.
//
// Runs a "server" and a "browser" in one Node process against the emulator:
// two Firebase apps, two atom registries. The server mounts read atoms, waits
// for the first snapshot, dehydrates, disposes. The browser hydrates a fresh
// registry and prints what the read atoms hold on their first read and after a
// live write. Both options from the ticket are built side by side.
//
//   vp run emulator   (or: vp exec firebase emulators:start --only firestore)
//   vpx packages/client/prototype/firestore-atom-ssr/run.ts
import * as App from "@visiolab/effect-firebase-client/app/App";
import * as ClientFirestore from "@visiolab/effect-firebase-client/firestore/ClientFirestore";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import * as FirestoreSchema from "@visiolab/effect-firebase/firestore/FirestoreSchema";
import * as Timestamp from "@visiolab/effect-firebase/firestore/Timestamp";
import { Cause, Effect, Layer, Option, Queue, Schema, SchemaGetter, Stream } from "effect";
import { AsyncResult, Atom, AtomRegistry, Hydration } from "effect/reactivity";
import * as Sdk from "firebase/firestore";
import * as clientValue from "../../src/firestore/internal/firestoreValue.ts";

const projectId = "demo-prototype-ssr";
const emulator = { host: "127.0.0.1", port: 8080 };

class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
const Users = Collection.make("users", User);

class Post extends FirestoreModel.Class<Post>("Post")({
  title: Schema.String,
  views: Schema.Finite,
  publishedAt: FirestoreSchema.Timestamp,
  // FINDING: core's DocumentReference (and DocumentPath) has no `toCodecJson`,
  // so `Schema.toCodecJson(Post)` fails with "Expected JSON value". Patched
  // here the way Timestamp does it: written as the path string.
  author: FirestoreSchema.DocumentReference(Users).annotate({
    toCodecJson: () =>
      Schema.link<Collection.DocumentReference<typeof Users>>()(Schema.String, {
        decode: SchemaGetter.transform((path: string) =>
          Users.doc(Users.id.make(path.split("/")[1]!)),
        ),
        encode: SchemaGetter.transform(
          (ref: Collection.DocumentReference<typeof Users>) => ref.path,
        ),
      }),
  } as never),
  cover: Schema.Uint8Array,
}) {}
const Posts = Collection.make("posts", Post);

const p1 = Posts.doc(Posts.id.make("p1"));
const gone = Posts.doc(Posts.id.make("gone"));
const all = Posts.collection();

// ── Decoded Snapshots (prototype-local shape, per #214) ─────────────────────
type Metadata = { readonly fromCache: boolean; readonly hasPendingWrites: boolean };
type Raw<S> = S | Schema.Json; // live SDK snapshot, or its JSON before it is rebuilt
type DecodedDoc =
  | {
      _tag: "Existing";
      path: string;
      data: Post;
      metadata: Metadata;
      raw: Raw<Sdk.DocumentSnapshot>;
    }
  | { _tag: "Missing"; path: string; metadata: Metadata; raw: Raw<Sdk.DocumentSnapshot> };
type DecodedDocs = {
  docs: ReadonlyArray<{ path: string; data: Post; metadata: Metadata }>;
  metadata: Metadata;
  raw: Raw<Sdk.QuerySnapshot>;
};

const metaOf = (m: Sdk.SnapshotMetadata): Metadata => ({
  fromCache: m.fromCache,
  hasPendingWrites: m.hasPendingWrites,
});

const decodeData = (path: string, snap: Sdk.DocumentSnapshot) =>
  Effect.gen(function* () {
    const raw = yield* Effect.fromResult(
      clientValue.readDocument(path, snap.data({ serverTimestamps: "estimate" })),
    );
    const s = DocumentSnapshot.make(Posts.doc(Posts.id.make(snap.id)), raw);
    return s._tag === "Existing" ? Option.some((yield* s.data) as Post) : Option.none<Post>();
  });

const decodeDoc = (snap: Sdk.DocumentSnapshot) =>
  Effect.map(decodeData(snap.ref.path, snap), (data): DecodedDoc =>
    Option.isSome(data)
      ? {
          _tag: "Existing",
          path: snap.ref.path,
          data: data.value,
          metadata: metaOf(snap.metadata),
          raw: snap,
        }
      : { _tag: "Missing", path: snap.ref.path, metadata: metaOf(snap.metadata), raw: snap },
  );

const decodeDocs = (snap: Sdk.QuerySnapshot) =>
  Effect.map(
    Effect.forEach(snap.docs, (d) =>
      Effect.map(decodeData(d.ref.path, d), (data) => ({
        path: d.ref.path,
        data: Option.getOrThrow(data),
        metadata: metaOf(d.metadata),
      })),
    ),
    (docs): DecodedDocs => ({ docs, metadata: metaOf(snap.metadata), raw: snap }),
  );

// ── Listeners: fresh `onSnapshot`, or `onSnapshotResume` from JSON ──────────
const listen = <S>(subscribe: (next: (s: S) => void, err: (e: unknown) => void) => () => void) =>
  Stream.callback<S, unknown>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() =>
        subscribe(
          (s) => void Queue.offerUnsafe(queue, s),
          (e) => void Queue.failCauseUnsafe(queue, Cause.fail(e)),
        ),
      ),
      (unsub) => Effect.sync(unsub),
    ),
  );

const docStream = (db: Sdk.Firestore, path: string, resume?: Schema.Json) =>
  listen<Sdk.DocumentSnapshot>((next, err) =>
    resume === undefined
      ? Sdk.onSnapshot(Sdk.doc(db, path), next, err)
      : (Sdk.onSnapshotResume(db, resume as object, next as never, err) as () => void),
  ).pipe(Stream.mapEffect(decodeDoc));

const docsStream = (db: Sdk.Firestore, path: string, resume?: Schema.Json) =>
  listen<Sdk.QuerySnapshot>((next, err) =>
    resume === undefined
      ? Sdk.onSnapshot(Sdk.collection(db, path), next, err)
      : (Sdk.onSnapshotResume(db, resume as object, next as never, err) as () => void),
  ).pipe(Stream.mapEffect(decodeDocs));

// FINDING: a Missing doc's toJSON() has `bundle: ""`; documentSnapshotFromJSON
// dies on it and onSnapshotResume rejects it. Hold `null` and listen fresh.
const toJSON = (raw: Raw<{ toJSON(): object }>): Schema.Json => {
  if (typeof (raw as any)?.toJSON !== "function") return raw as Schema.Json;
  const json = (raw as any).toJSON();
  return json.bundle === "" ? null : json;
};

// ── Runtimes: one app per side ──────────────────────────────────────────────
const clientLayer = (appName: string) =>
  ClientFirestore.layer({ emulator }).pipe(Layer.provide(App.layer({ projectId }, appName)));
// ASYNC_LAYER=1: the browser's layer takes a tick to build (e.g. it awaits
// auth or config), to see what that does to the first read.
const runtimeFor = (appName: string) =>
  Atom.runtime(
    process.env["ASYNC_LAYER"] && appName.startsWith("browser")
      ? Layer.merge(clientLayer(appName), Layer.effectDiscard(Effect.sleep(5)))
      : clientLayer(appName),
  );

const instance = Effect.map(Effect.service(ClientFirestore.ClientFirestore), (s) => s.instance);

// ── Option 1: hidden raw atom ───────────────────────────────────────────────
const option1 = (runtime: ReturnType<typeof runtimeFor>) => {
  const rawAtom = Atom.family((key: string) =>
    Atom.make<Schema.Json | null>(null).pipe(
      Atom.keepAlive,
      Atom.serializable({ key: `raw:${key}`, schema: Schema.NullOr(Schema.Json) }),
    ),
  );
  const make = <A extends DecodedDoc | DecodedDocs>(
    key: string,
    stream: (db: Sdk.Firestore, resume?: Schema.Json) => Stream.Stream<A, unknown>,
    fromJSON: (db: Sdk.Firestore, json: object) => Sdk.DocumentSnapshot | Sdk.QuerySnapshot,
    decode: (s: any) => Effect.Effect<A, unknown>,
  ) =>
    runtime.atom((get) => {
      const seedJson = get.once(rawAtom(key));
      return Stream.unwrap(
        Effect.gen(function* () {
          const db = yield* instance;
          const live = stream(
            db,
            (seedJson as any)?.missing ? undefined : (seedJson ?? undefined),
          ).pipe(
            Stream.tap((a) =>
              Effect.sync(() =>
                get.set(
                  rawAtom(key),
                  (a as any)._tag === "Missing" ? { missing: true } : toJSON(a.raw as never),
                ),
              ),
            ),
          );
          if (seedJson === null) return live;
          if ((seedJson as any).missing) {
            const seed: DecodedDoc = {
              _tag: "Missing",
              path: key,
              metadata: { fromCache: false, hasPendingWrites: false },
              raw: null,
            };
            return Stream.concat(Stream.succeed(seed as A), stream(db));
          }
          const seed = yield* decode(fromJSON(db, seedJson as object));
          return Stream.concat(Stream.succeed(seed), live);
        }),
      );
    });
  return {
    doc: (path: string) =>
      make(path, (db, r) => docStream(db, path, r), Sdk.documentSnapshotFromJSON, decodeDoc),
    docs: (path: string) =>
      make(path, (db, r) => docsStream(db, path, r), Sdk.querySnapshotFromJSON, decodeDocs),
  };
};

// ── Option 2: the read atom itself is serializable ─────────────────────────
// `raw` encodes as `toJSON()` and decodes to the JSON as is: no Firestore
// instance inside a schema, so it can't become an SDK snapshot here.
const RawJson = Schema.Json.pipe(
  Schema.decodeTo(Schema.Any, {
    decode: SchemaGetter.transform((j) => j),
    encode: SchemaGetter.transform((r: any) => toJSON(r)),
  }),
);
const PostJson = Schema.toCodecJson(Post);
const MetaJson = Schema.Struct({ fromCache: Schema.Boolean, hasPendingWrites: Schema.Boolean });
const DocJson = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Existing"),
    path: Schema.String,
    data: PostJson,
    metadata: MetaJson,
    raw: RawJson,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Missing"),
    path: Schema.String,
    metadata: MetaJson,
    raw: RawJson,
  }),
]);
const DocsJson = Schema.Struct({
  docs: Schema.Array(Schema.Struct({ path: Schema.String, data: PostJson, metadata: MetaJson })),
  metadata: MetaJson,
  raw: RawJson,
});

const option2 = (runtime: ReturnType<typeof runtimeFor>) => {
  const make = <A extends DecodedDoc | DecodedDocs>(
    key: string,
    schema: Schema.Codec<A, any>,
    stream: (db: Sdk.Firestore, resume?: Schema.Json) => Stream.Stream<A, unknown>,
  ) =>
    runtime
      .atom((get) => {
        const seed = get.self<AsyncResult.AsyncResult<A, unknown>>().pipe(
          Option.flatMap(AsyncResult.value),
          Option.map((a) => a.raw),
          // A hydrated seed still holds JSON; a live value holds an SDK snapshot.
          Option.filter((raw) => raw !== null && typeof (raw as any)?.toJSON !== "function"),
        );
        return Stream.unwrap(
          Effect.map(instance, (db) => stream(db, Option.getOrUndefined(seed) as Schema.Json)),
        );
      })
      .pipe(
        Atom.serializable({
          key: `doc2:${key}`,
          schema: AsyncResult.Schema({ success: schema as any, error: Schema.Defect() }) as any,
        }),
      );
  return {
    doc: (path: string) => make(path, DocJson as never, (db, r) => docStream(db, path, r)),
    docs: (path: string) => make(path, DocsJson as never, (db, r) => docsStream(db, path, r)),
  };
};

// ── Driver ──────────────────────────────────────────────────────────────────
const show = (r: AsyncResult.AsyncResult<any, any>) => {
  if (r._tag === "Initial") return `Initial(waiting=${r.waiting})`;
  if (r._tag === "Failure") return `Failure(${String(r.cause).slice(0, 200)})`;
  const v = r.value;
  const rawKind = typeof v.raw?.toJSON === "function" ? "SdkSnapshot" : "Json";
  const body =
    "docs" in v
      ? `docs=[${v.docs.map((d: any) => `${d.data.title}:${d.data.views}`).join(", ")}]`
      : v._tag === "Existing"
        ? `Existing ${v.data.title}:${v.data.views} author=${v.data.author?.path} at=${v.data.publishedAt?.seconds} cover=${v.data.cover?.length}B`
        : "Missing";
  return `Success(waiting=${r.waiting}) ${body} meta=${JSON.stringify(v.metadata)} raw=${rawKind}`;
};

const firstNonInitial = (registry: AtomRegistry.AtomRegistry, atom: Atom.Atom<any>) =>
  new Promise<void>((resolve) => {
    // FINDING: the server's first collection snapshot can be a partial one from
    // its own cache (fromCache: true), seeded by the doc listen. Wait for one
    // the server confirmed before dehydrating.
    const check = (v: any) =>
      v._tag === "Failure" || (v._tag === "Success" && !v.value.metadata.fromCache);
    if (check(registry.get(atom))) return resolve();
    const un = registry.subscribe(atom, (v) => {
      if (check(v)) {
        un();
        resolve();
      }
    });
  });

const seedData = async () => {
  await fetch(
    `http://${emulator.host}:${emulator.port}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    {
      method: "DELETE",
    },
  );
  await Effect.runPromise(
    Effect.gen(function* () {
      const fs = yield* ClientFirestore.ClientFirestore;
      for (const [id, title, views] of [
        ["p1", "Hello", 1],
        ["p2", "World", 2],
        ["p3", "Again", 3],
      ] as const)
        yield* fs.setDoc(Posts.doc(Posts.id.make(id)), {
          title,
          views,
          publishedAt: Timestamp.makeUnsafe(1_700_000_000, 123_456_789),
          author: Users.doc(Users.id.make("alice")),
          cover: new Uint8Array([1, 2, 3, 4]),
        } as never);
    }).pipe(Effect.provide(clientLayer("seeder"))),
  );
};

const main = async () => {
  await seedData();
  for (const [name, build] of [
    ["Option 1 (hidden raw atom)", option1],
    ["Option 2 (serializable read atom)", option2],
  ] as const) {
    console.log(`\n════ ${name} ════`);
    // Server
    const server = build(runtimeFor(`server-${name}`));
    const sReg = AtomRegistry.make();
    const sAtoms: Record<string, Atom.Atom<AsyncResult.AsyncResult<any, any>>> = {
      doc: server.doc(p1.path),
      missing: server.doc(gone.path),
      docs: server.docs(all.path),
    };
    for (const a of Object.values(sAtoms)) sReg.mount(a);
    for (const [k, a] of Object.entries(sAtoms)) {
      await firstNonInitial(sReg, a);
      console.log(`server ${k}:`, show(sReg.get(a)));
    }
    const state = Hydration.dehydrate(sReg);
    const wire = JSON.stringify(
      Hydration.toValues(state).map(({ key, value }) => ({ key, value })),
    );
    sReg.dispose();
    for (const d of Hydration.toValues(state)) {
      const json = JSON.stringify(d.value);
      console.log(`dehydrated ${d.key}: ${json.length} chars`);
      if (d.key.includes("gone")) console.log(`  missing doc JSON: ${json.slice(0, 400)}`);
    }
    console.log(`wire total: ${wire.length} chars`);

    // Browser
    const browser = build(runtimeFor(`browser-${name}`));
    const bReg = AtomRegistry.make();
    Hydration.hydrate(
      bReg,
      JSON.parse(wire).map((x: any) => ({
        ...x,
        "~effect/reactivity/Hydration/DehydratedAtom": true,
      })),
    );
    const bAtoms: Record<string, Atom.Atom<AsyncResult.AsyncResult<any, any>>> = {
      doc: browser.doc(p1.path),
      missing: browser.doc(gone.path),
      docs: browser.docs(all.path),
    };
    for (const [k, a] of Object.entries(bAtoms)) {
      // First read, synchronously, as a first render would.
      console.log(`browser ${k} first read:`, show(bReg.get(a)));
      bReg.mount(a);
      console.log(`browser ${k} after mount:`, show(bReg.get(a)));
    }
    await new Promise((r) => setTimeout(r, 500));
    for (const [k, a] of Object.entries(bAtoms))
      console.log(`browser ${k} +500ms:`, show(bReg.get(a)));

    // Live: write from another client, see the browser atoms follow.
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* instance;
        yield* Effect.promise(() => Sdk.updateDoc(Sdk.doc(db, p1.path), { views: 100 }));
        yield* Effect.promise(() =>
          Sdk.setDoc(Sdk.doc(db, gone.path), {
            title: "Back",
            views: 7,
            publishedAt: Sdk.Timestamp.now(),
            author: Sdk.doc(db, "users/bob"),
            cover: Sdk.Bytes.fromUint8Array(new Uint8Array([9])),
          }),
        );
      }).pipe(
        Effect.provide(
          ClientFirestore.layer({ emulator }).pipe(
            Layer.provide(App.layer({ projectId }, `writer-${name}`)),
          ),
        ),
      ),
    );
    await new Promise((r) => setTimeout(r, 1000));
    for (const [k, a] of Object.entries(bAtoms))
      console.log(`browser ${k} after write:`, show(bReg.get(a)));
    // reset for the next option
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* instance;
        yield* Effect.promise(() => Sdk.updateDoc(Sdk.doc(db, p1.path), { views: 1 }));
        yield* Effect.promise(() => Sdk.deleteDoc(Sdk.doc(db, gone.path)));
      }).pipe(
        Effect.provide(
          ClientFirestore.layer({ emulator }).pipe(
            Layer.provide(App.layer({ projectId }, `reset-${name}`)),
          ),
        ),
      ),
    );
    bReg.dispose();
  }

  // Q3 / Q5 raw facts
  console.log("\n════ Raw facts ════");
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* instance;
      const missing = yield* Effect.promise(() => Sdk.getDoc(Sdk.doc(db, gone.path)));
      console.log("missing toJSON:", JSON.stringify(missing.toJSON()));
      try {
        Sdk.documentSnapshotFromJSON(db, missing.toJSON());
        console.log("missing fromJSON: ok");
      } catch (e) {
        console.log("missing fromJSON throws:", String(e).slice(0, 200));
      }
      const q = yield* Effect.promise(() => Sdk.getDocs(Sdk.collection(db, all.path)));
      const plain = JSON.stringify(q.docs.map((d) => ({ id: d.id, ...d.data() })));
      const sdk = JSON.stringify(q.toJSON());
      console.log(
        `collection of 3: plain data ${plain.length} chars, toJSON ${sdk.length} chars (${(sdk.length / plain.length).toFixed(1)}x)`,
      );
      const rebuilt = Sdk.querySnapshotFromJSON(db, q.toJSON());
      console.log(
        "rebuilt query metadata:",
        JSON.stringify(rebuilt.metadata),
        "docs",
        rebuilt.size,
      );
      console.log("toJSON sample:", sdk.slice(0, 600));
    }).pipe(
      Effect.provide(
        ClientFirestore.layer({ emulator }).pipe(Layer.provide(App.layer({ projectId }, "facts"))),
      ),
    ),
  );
  process.exit(0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
