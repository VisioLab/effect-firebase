# Firestore snapshot resume and Effect's Hydration

Research for [#212](https://github.com/VisioLab/effect-firebase/issues/212), under the map [#210](https://github.com/VisioLab/effect-firebase/issues/210) (Effect Atom support for Firestore).

Question: what does the Firebase JS SDK (v13) offer for SSR, which SDK can produce the serialized snapshot on the server, how does `effect/reactivity`'s `Hydration` dehydrate and rehydrate atoms, and where would a resumed Firestore listener plug in?

Versions read: `firebase@13.0.0` → `@firebase/firestore@4.18.0`, `firebase-admin@14.5.0` → `@google-cloud/firestore@9.1.0`, `effect@4.1.0`. Paths below are under `node_modules/.pnpm/`.

## Summary

- The client SDK has four SSR APIs: `DocumentSnapshot.toJSON()`, `QuerySnapshot.toJSON()`, `documentSnapshotFromJSON` / `querySnapshotFromJSON`, and `onSnapshotResume`. They shipped in Firebase JS SDK **11.10.0** (June 26, 2025).
- The serialized form is a small wrapper `{ type, bundleSource, bundleName, bundle }`. `bundle` is a full **Firestore data bundle** as a string, the same format `loadBundle` reads.
- **Only the Node build of the client SDK can produce it.** The browser build writes `bundle: "NOT SUPPORTED"`, and every consumer rejects that. `fromJSON` and `onSnapshotResume` work in the browser.
- The **Admin SDK has no `toJSON`**, but its `firestore.bundle()` builds a bundle in the same format. Wrapping that bundle by hand gives JSON that `onSnapshotResume` should accept. This is untested.
- `onSnapshotResume` = `loadBundle(bundle)`, then a plain `onSnapshot` on the document (from `bundleName`) or on the named query (from `namedQuery(bundleName)`). For a **query**, loading the named query sets a resume read time on the target, so the listen asks the server only for changes since the bundle. Firebase bills only those deltas when the bundle is under 30 minutes old.
- `Hydration` moves **decoded atom values**, keyed by `Atom.serializable({ key, schema })`. `hydrate` stores the encoded value. The first `ensureNode` of an atom with that key decodes it and seeds the node. A seeded **stream atom** shows the seed as `waiting` and still starts its stream, unless `skipInitialRun` is set.
- That seed is where a resumed listener plugs in. The atom's read function can see the seed through `get.self()`. If the seed carries the SDK's snapshot JSON, the stream can use `onSnapshotResume` in place of `onSnapshot`. Effect's own precedent, `AtomRpc`, does not make stream atoms serializable at all, so this would be new ground.

## 1. What the client SDK offers

### API surface (`@firebase/firestore@4.18.0/dist/index.d.ts`)

| API                                                                                                                        | Declared at   | Notes                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `DocumentSnapshot.toJSON(): object`                                                                                        | l. 925–931    | "Throws a `FirestoreError` if this `DocumentSnapshot` has pending writes."                                                         |
| `QuerySnapshot.toJSON(): object`                                                                                           | l. 3346–3352  | Same pending-writes rule.                                                                                                          |
| `documentSnapshotFromJSON(db, json, converter?)`                                                                           | l. 942–973    | Synchronous. Returns a `DocumentSnapshot`.                                                                                         |
| `querySnapshotFromJSON(db, json, converter?)`                                                                              | l. 3356–3387  | Synchronous. Returns a `QuerySnapshot`.                                                                                            |
| `onSnapshotResume(firestore, snapshotJson, [options], onNext, onError?, onCompletion?, converter?)` and observer overloads | l. 2560–2810  | Eight overloads: document or query, with or without `SnapshotListenOptions`, with callbacks or an observer. Returns `Unsubscribe`. |
| `loadBundle(firestore, bundleData)` / `namedQuery(firestore, name)`                                                        | l. 2092, 2341 | Older bundle APIs that `onSnapshotResume` is built on.                                                                             |

Release note, [Firebase JS SDK 11.10.0, June 26, 2025](https://firebase.google.com/support/release-notes/js): Firestore result types "can be serialized with `toJSON` and then deserialized with `fromJSON` methods", and "Added support to resume `onSnapshot` listeners in the CSR phase based on serialized `DataSnapshot`s and `QuerySnapshot`s built in the SSR phase." Release 12.11.0 (March 19, 2026) "Fixed 'X is not a function' issues observed in server side rendering APIs."

### The serialized form

From the Node build, `dist/index.node.mjs` l. 1719–1739 (document) and l. 1874–1900 (query):

```js
// DocumentSnapshot.toJSON()
{ type: "firestore/documentSnapshot/1.0", bundleSource: "DocumentSnapshot",
  bundleName: this._key.toString(),   // the document path, e.g. "posts/hello"
  bundle: buildDocumentSnapshotJsonBundle(...) }   // "" if the document is missing

// QuerySnapshot.toJSON()
{ type: "firestore/querySnapshot/1.0", bundleSource: "QuerySnapshot",
  bundleName: AutoId.newId(),          // a random name for the named query
  bundle: buildQuerySnapshotJsonBundle(...) }
```

`bundle` is built by a `BundleBuilder` (`index.node.mjs` l. 1392–1546): length-prefixed JSON elements (`metadata`, then `namedQuery`, then `documentMetadata` / `document` per document), `BUNDLE_VERSION = 1`. That is the Firestore data bundle format, and the class is a port of the Admin SDK's own `BundleBuilder` (compare `@google-cloud/firestore/build/src/bundle.js`). Each document's `readTime` comes from the snapshot (`documentToDocumentSnapshotBundleData`, l. 1585–1595).

### Which build can produce it

- **Browser / ESM build** (`dist/common-D9UYuXJO.esm.js` l. 29491–29499, 29640–29652): `toJSON()` sets `bundle = "NOT SUPPORTED"`. The bundle builder is left out of the browser build.
- **Consumers reject that**: `documentSnapshotFromJSON` / `querySnapshotFromJSON` throw `INVALID_ARGUMENT` "The provided JSON object was created in a client environment, which is not supported." (`index.node.mjs` l. 1750, 1911; the same check is in the browser build, l. 29504, 29657).
- **Node build** (`package.json` `exports["."].node`) builds a real bundle. So on the server, the **client SDK running in Node** produces resumable JSON, and the browser consumes it.

### How `onSnapshotResume` works (`dist/index.esm.js` l. 1327–1480)

1. It checks only that `bundle`, `bundleName` and `bundleSource` are non-empty strings, and throws `INVALID_ARGUMENT` **synchronously** otherwise. It does not check `type`.
2. `bundleSource === "QuerySnapshot"`: `loadBundle(firestore, bundle)`, then `namedQuery(firestore, bundleName)`, then `onSnapshot(query, options, observer)`.
3. `bundleSource === "DocumentSnapshot"`: `loadBundle(firestore, bundle)`, then `onSnapshot(doc(bundleName), options, observer)`.
4. A failed load goes to `onError`. Unsubscribing before the bundle has loaded stops the listen from starting.

So a resumed listen is an ordinary listen, started after the bundle's documents are in the local cache. Its first snapshot can come from the cache, and later ones come from the server.

**Saving reads.** Loading a named query allocates a target and, if the bundle is newer than what the cache holds, sets the target's resume point to the bundle's read time (`localStoreSaveNamedQuery`, `dist/common-C1sORuFu.node.mjs` l. 35664–35689: "Allocate a target for the named query such that it can be resumed from associated read time if users use it to listen."). The [bundles guide](https://firebase.google.com/docs/firestore/bundles) says that if you load a named query from a bundle built less than 30 minutes ago and use it to read from the backend, you only pay for the reads needed to bring it up to date: "only pay for the deltas". A **document** bundle has no named query, so a resumed document listen gets no such resume point, and the listen probably costs one read like any other. The same source comment warns that the allocated target "will remain active and will not get collected" unless that query is listened to and released.

### Caveats from the source

- **Pending writes**: `toJSON` throws `FAILED_PRECONDITION` while `metadata.hasPendingWrites` is set ("Await waitForPendingWrites() before invoking toJSON()"). This doesn't arise on a server that only reads.
- **Metadata is not carried**: `fromJSON` always builds snapshots with `hasPendingWrites: false, fromCache: false` (`index.node.mjs` l. 1770–1772). `Snapshot Metadata` does not survive the trip. A resumed listen reports its own metadata.
- **Missing documents cannot be resumed from client-made JSON**: `DocumentSnapshot.toJSON()` of a missing document returns `bundle: ""` (l. 1728–1735), and `onSnapshotResume` rejects an empty `bundle`. `documentSnapshotFromJSON` would also find no document in the bundle. A **Document Snapshot** that is `Missing` needs its own path, for example a plain listen.
- **Converters**: `onSnapshotResume` and `*FromJSON` take an SDK `FirestoreDataConverter`. This repo decodes with its own codec (ADR 0002), so it would pass none and map the raw snapshot, as `streamDoc` does today.
- **Synchronous throw**: invalid JSON throws from `onSnapshotResume` itself, not through `onError`. `Firestore.streamFromListener` runs `subscribe` inside `Effect.sync` (`packages/effect-firebase/src/firestore/internal/streamFromListener.ts`), so such a throw would become a defect, not a `FirestoreError`.
- **Security**: the bundles guide warns that the Admin SDK "acts as a privileged user and does not evaluate Security Rules", so only publicly readable data should be bundled. The same applies to anything the server dehydrates into HTML.

## 2. Which server-side SDK can produce it

| Producer                                                               | Produces resumable JSON?                                                                                                                                                                                                           | Security Rules             | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client SDK in a browser                                                | No: `bundle: "NOT SUPPORTED"`                                                                                                                                                                                                      | yes                        |                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Client SDK in Node (`firebase/firestore` resolves to `index.node.mjs`) | **Yes**, via `toJSON()`                                                                                                                                                                                                            | yes, as the signed-in user | For per-user data on the server, `initializeServerApp(options, { authIdToken })` from `firebase/app` (`@firebase/app@0.16.3`, `app-public.d.ts` l. 191–250) signs the SDK in as the request's user. This keeps the "Client Firestore only" stance: the server runs **Client Firestore** too.                                                                                                                                                                  |
| Admin SDK (`firebase-admin/firestore` = `@google-cloud/firestore`)     | No `toJSON`. **Yes, by hand**: `firestore.bundle(id).add(docSnap)` or `.add(name, querySnap)`, then `.build()` returns a `Buffer` in the same bundle format (`types/firestore.d.ts` l. 757–766, 2986–3020; `build/src/bundle.js`). | **no**: privileged         | Wrap it as `{ type: "firestore/documentSnapshot/1.0", bundleSource: "DocumentSnapshot", bundleName: docSnap.ref.path, bundle: buf.toString("utf8") }`, or for a query use `bundleSource: "QuerySnapshot"` and the name passed to `add`. Unlike the client, the Admin builder writes `documentMetadata { exists: false }` for a missing document, so a missing document could be resumed this way. Compatibility is inferred from the code and **not tested**. |

## 3. How `effect/reactivity` Hydration works (effect 4.1.0)

Sources: `effect@4.1.0/node_modules/effect/src/reactivity/Hydration.ts`, `Atom.ts` l. 1950–2010 and 3147–3375, `AtomRegistry.ts` l. 505–625, 855–955, 1105–1120, and `src/internal/hydration.ts`.

### What an atom must provide

`Atom.serializable(atom, { key, schema, skipInitialRun? })` (`Atom.ts` l. 3214–3274) attaches:

- `key: string`: the atom's identity in dehydrated state. It must be the same on server and client. `AtomRpc` uses `` `AtomRpc:${tag}:${serializationKey}` ``.
- `encode` / `decode` derived from `Schema.toCodecJson(schema)`, so the value must have a **synchronous** schema to JSON. For async atoms this is `AsyncResult.Schema({ success, error })`, as `AtomRpc` and `AtomHttpApi` do.
- `skipInitialRun` (since 4.1.0, `InitialValueOptions`): keep the seeded value and skip the first effect or stream run.

### Dehydrate (server)

`Hydration.dehydrate(registry, { encodeInitialAs })` walks `registry.getNodes()`, keeps only serializable atoms, and encodes each current value into `{ key, value, dehydratedAt, resultPromise? }`. Values that fail to encode are skipped silently. For an `AsyncResult.Initial` value, `encodeInitialAs` decides: `"ignore"` (default) drops it, `"value-only"` encodes the Initial, and `"promise"` adds a `resultPromise` that resolves once the atom leaves Initial, for streaming SSR.

### Hydrate (client)

`Hydration.hydrate(registry, state)` calls `registry.setSerializable(key, encoded)`, which only stores the value in `preloadedSerializable`. The value is applied by the **next `ensureNode`** of an atom with that key (`AtomRegistry.ts` l. 589–607). That call decodes the value, follows `initialValueTarget` to the source atom, and, if `shouldHydrate` allows it (a Success with a newer timestamp, or the current value is not a result), calls `setInitialValue(decoded, skipInitialRun)`. A `resultPromise` that resolves later is decoded and set on the node, or, if it can't be used, the hydrated Initial is released and the atom computes on the client.

### What a seeded stream atom does

`makeStream` (`Atom.ts` l. 1004–1068) reads `ctx.self()`:

- With a seed and `skipInitialRun`: it returns the seed and **does not run the stream** until the atom is refreshed or a dependency changes. That is wrong for a live listen, so Firestore atoms must not set `skipInitialRun`.
- With a seed and no `skipInitialRun`: it starts the stream and returns `AsyncResult.waitingFrom(seed)`. The UI shows the server's value, marked waiting, until the first snapshot replaces it. This is the behaviour Firestore atoms want.

`Atom.withServerValue(atom, read)` / `getServerValue(atom, registry)` let a server read an atom differently, for example as a one-off read in place of a listen.

**Precedent**: `AtomRpc` makes only non-stream queries serializable (`if (!isStream && key.serializationKey)`, `AtomRpc.ts` l. 235). There is no in-house example of a serializable stream atom.

## 4. Where a resumed Firestore listener could plug in

Today, `streamDoc` and `streamDocs` on **Client Firestore** (`packages/client/src/firestore/internal/firestore.ts` l. 207–226) wrap `Client.onSnapshot(docOf(path) | query, options, …)` in `Firestore.streamFromListener` and map each SDK snapshot to a **Document Snapshot** / **Query Snapshot** carrying **Snapshot Metadata** (`documentReadOf` / `queryReadOf`). A resumed variant only swaps `onSnapshot` for `onSnapshotResume(firestore, json, options, onNext, onError)`. The mapping, error handling and `ListenOptions` stay the same.

Three ways to meet Hydration, from least to most SDK-specific:

**A. Values only (no SDK resume).** Make the read atom serializable with `AsyncResult.Schema` over the decoded snapshot (path + model data through the model's JSON codec + metadata). The server fills it from anything: **Client Firestore** in Node, or a plain read. On the client the stream atom shows the seed as `waiting` and starts an ordinary `onSnapshot`, whose first snapshot replaces it.
Cost: the client re-reads everything from the server. It needs no SDK JSON, works for `Missing` documents, and fits Hydration as is. Open question: what **Snapshot Metadata** a seed claims, since the value is neither from this client's cache nor current from the server.

**B. Values plus resume JSON in the seed.** Same as A, but the dehydrated value also carries the SDK's snapshot JSON (`toJSON()` from **Client Firestore** in Node). On the client the atom's read function sees the seed through `get.self()` and, if it holds the JSON, listens with `onSnapshotResume`. Query listens then resume from the bundle's read time (delta billing under 30 minutes). Everything goes through the one Hydration channel, and the ordering is right because `onSnapshotResume` awaits `loadBundle` before listening.
Costs: the payload holds the data twice (decoded value and proto3-JSON bundle). The JSON has to live somewhere in the atom's value type. A `Missing` document has no JSON, so it falls back to A. And this would be the first serializable stream atom.

**C. Snapshot JSON as the only serialized form.** The encoded value is the SDK JSON, and decoding goes through `documentSnapshotFromJSON` / `querySnapshotFromJSON` and then `documentReadOf` / `queryReadOf`. This blocks on Hydration's design: `decode` is a synchronous schema with no access to services, but `*FromJSON` needs the `Firestore` instance (its database id and value writer). The schema would have to close over a specific database, which atoms defined as module constants don't have. Not workable without a per-database atom family.

A side channel outside Hydration is also possible: call `loadBundle` on every shipped bundle before mounting, then listen normally. It is **racy**, because `loadBundle` is async and a listen that starts first does a full server read. It also only resumes a query if the client builds a query whose canonical target equals the bundled one. B avoids both problems.

## Open risks

1. **Admin bundles in `onSnapshotResume`** are inferred compatible from source, not tested. Worth a quick prototype if the server side may run on the Admin SDK.
2. **Server runtime**: the client SDK in Node per request means `initializeServerApp` with `authIdToken`, and closing the listener or app afterwards. A listening atom on the server never completes, so the server should read once (`Atom.withServerValue`, or `dehydrate` with `encodeInitialAs: "promise"` and then dispose the registry).
3. **Missing documents** have no resumable client JSON. They need path A.
4. **Metadata semantics of a seed**, and whether atoms keep `hasPendingWrites` / `fromCache` across hydration.
5. **Leaked targets**: every loaded named query allocates a target that stays active until listened to and released. Bundles shipped but never listened to (for example, an atom never mounted on the client) leave a target behind.
6. **Payload size**: the proto3 JSON bundle is verbose, and B ships the data twice.
7. **Synchronous throws** from `onSnapshotResume` on bad JSON become defects through `streamFromListener` unless they are caught there.
8. **Effect API stability**: `Hydration`, `Atom.serializable` and `skipInitialRun` are `@stability unstable`, and `skipInitialRun` is new in 4.1.0.
