# How Effect's atom integrations and existing Firestore bindings shape their APIs

Research for [#211](https://github.com/VisioLab/effect-firebase/issues/211), part of the map [#210](https://github.com/VisioLab/effect-firebase/issues/210) (Effect Atom support for Firestore). It feeds the API-shape prototype [#213](https://github.com/VisioLab/effect-firebase/issues/213).

**Question.** How do `AtomRpc`, `AtomHttpApi`, `Reactivity` and `AsyncResult` in effect 4.1 (`effect/reactivity`) wrap a service as atoms: query vs mutation, families and keys, `reactivityKeys`, idle TTL and keep-alive, streams as atoms? How do reactfire, TanStack Query Firebase and VueFire handle listener sharing, keys, pending writes and errors? Which patterns should the prototype pick between?

## Sources

All claims below are from these primary sources, read on 2026-11-10.

| Ref          | Source                                                                                                                                                                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [E-Atom]     | `effect@4.1.0` `src/reactivity/Atom.ts` (in `node_modules/.pnpm/effect@4.1.0/node_modules/effect/`)                                                                                                                                                                                        |
| [E-Rpc]      | `effect@4.1.0` `src/reactivity/AtomRpc.ts`                                                                                                                                                                                                                                                 |
| [E-Http]     | `effect@4.1.0` `src/reactivity/AtomHttpApi.ts`                                                                                                                                                                                                                                             |
| [E-React]    | `effect@4.1.0` `src/reactivity/Reactivity.ts`                                                                                                                                                                                                                                              |
| [E-Result]   | `effect@4.1.0` `src/reactivity/AsyncResult.ts`                                                                                                                                                                                                                                             |
| [E-Reg]      | `effect@4.1.0` `src/reactivity/AtomRegistry.ts`                                                                                                                                                                                                                                            |
| [E-Equal]    | `effect@4.1.0` `src/Equal.ts`                                                                                                                                                                                                                                                              |
| [RF]         | [FirebaseExtended/reactfire@eb3376a](https://github.com/FirebaseExtended/reactfire/tree/eb3376ac5db710a351730c1f4f66651013a11922/src): `firestore.tsx`, `useObservable.ts`, `SuspenseSubject.ts`                                                                                           |
| [RX]         | [FirebaseExtended/rxfire@877b8a1](https://github.com/FirebaseExtended/rxfire/blob/877b8a1a62431b61d2f6d0cbe669b36a4389d4eb/firestore/document/index.ts) `firestore/document/index.ts`                                                                                                      |
| [TQF]        | [invertase/tanstack-query-firebase@765be69](https://github.com/invertase/tanstack-query-firebase/tree/765be6939754a17b8844fa87c88792cddf17d36a/packages/react/src/firestore) `packages/react/src/firestore/*`, `docs/react/data-connect/{mutations,querying}.mdx`                          |
| [RQF]        | Legacy v1, branch [`react-query-firebase`@7056b89](https://github.com/invertase/tanstack-query-firebase/tree/7056b89c8350be1c02dcd4c558f8f2db2470039b): `packages/firestore/src/useFirestoreDocument.ts`, `packages/utils/src/useSubscription.ts`, `docs/firestore/querying-documents.mdx` |
| [VF]         | [vuejs/vuefire@efec240](https://github.com/vuejs/vuefire/tree/efec2403e6137fc3ad051ede1808e3b383b25710/src/firestore): `src/firestore/useFirestoreRef.ts`, `src/firestore/bind.ts`, `docs/guide/{realtime-data,old_writing-data,ssr}.md`                                                   |
| [SDK-EM]     | [firebase/firebase-js-sdk@cd161bf](https://github.com/firebase/firebase-js-sdk/blob/cd161bf5be6a4ec7bb6b27073ca7af764bc7e933/packages/firestore/src/core/event_manager.ts) `packages/firestore/src/core/event_manager.ts`                                                                  |
| [SDK-Ref]    | same commit, `packages/firestore/src/api/reference_impl.ts` (JSDoc of `setDoc` and friends)                                                                                                                                                                                                |
| [FB-Listen]  | [Get realtime updates with Cloud Firestore](https://firebase.google.com/docs/firestore/query-data/listen)                                                                                                                                                                                  |
| [FB-Offline] | [Access data offline](https://firebase.google.com/docs/firestore/manage-data/enable-offline)                                                                                                                                                                                               |
| [Repo]       | This repo: `packages/client/src/firestore/ClientFirestore.ts`, `packages/client/src/firestore/internal/firestore.ts`, `packages/effect-firebase/src/firestore/{Firestore,Collection}.ts`, `packages/effect-firebase/src/firestore/internal/collection.ts`                                  |

## Summary

- **Effect's precedent is one shape, used twice.** `AtomRpc.Service` and `AtomHttpApi.Service` both build a `Context.Service` class whose static side carries an `AtomRuntime` built from a layer, a `query(...)` that returns a read atom from an `Atom.family` keyed by a structural options object, and a `mutation(...)` that returns an `AtomResultFn` from an `Atom.family` keyed by the operation only, with the operation's input (and `reactivityKeys`) passed on each write. [E-Rpc] [E-Http]
- **Sharing comes from atom identity, not from the integration.** `Atom.family` returns the same atom object for keys that are `Equal`, and the registry keeps one node per atom, so one atom means one running Effect or Stream per registry. Our `DocumentReference` and `CollectionReference` already implement `Equal` by path and collection, so they can be family keys as they are. [E-Atom] [E-Reg] [Repo]
- **The SDK already shares the network listener.** Identical queries reuse one backend watch inside the client SDK's `EventManager`. Atom-level sharing therefore saves decoding work and gives every reader the same `AsyncResult`; it does not save network. [SDK-EM]
- **Live reads and `reactivityKeys` do not mix well.** `withReactivity` refreshes an atom when its keys are invalidated, and refreshing a Stream atom re-runs the stream, which re-attaches the listener. A listener already sees local writes before they reach the server (latency compensation), so invalidation adds nothing for live reads. It only matters for one-off reads. [E-Atom] [FB-Listen]
- **Write promises wait for the server.** `setDoc`/`updateDoc`/`addDoc` resolve only once the backend has the write, and may not resolve for a long time offline. A mutation atom over them stays `waiting` until then, even though listeners already show the write. [SDK-Ref]
- **The bindings each pick a different point.** reactfire: live only, keyed by an internal string id from the ref's path, one shared rxjs subject per id, errors thrown, no write helpers. TanStack Query Firebase v2: one-off reads only, the user supplies query keys, one mutation hook per SDK write; its Data Connect hooks add an `invalidate` option. VueFire: one listener per composable call (no sharing), state as `data`/`pending`/`error`/`promise`, no write helpers, SSR keys inferred from the path. None of them expose `hasPendingWrites` as a first-class field. [RF] [TQF] [VF]

## 1. How `effect/reactivity` wraps a service as atoms

### 1.1 Service and runtime wiring

- `AtomRpc.Service<Self>()(id, options)` creates a `Context.Service` whose service is the flattened RPC client, then attaches three statics: `runtime`, `mutation` and `query`. `runtime` is `options.runtime ?? Atom.runtime` applied to `Layer.provide(clientLayer, Layer.orDie(options.protocol))`. `protocol` may be a layer or `(get: AtomContext) => Layer`, so the layer can depend on other atoms. [E-Rpc]
- `AtomHttpApi.Service` is the same, with `httpClient` in place of `protocol`. It also turns `SchemaError` and `HttpClientError` into defects (`Effect.die`) before they reach the atom, so only the endpoint's declared errors stay typed. [E-Http]
- `Atom.runtime` (= `Atom.context()`) is a `RuntimeFactory`. Each `AtomRuntime` is itself an atom of `AsyncResult<Context<R>, ER>`; it builds its layer with a `Layer.MemoMap` scoped to the registry by default, so two runtimes that share a layer build it once per registry. `factory.addGlobalLayer` merges a layer into every runtime of that factory, and `Reactivity.layer` is always in the global layer. [E-Atom] (`context()`, `RuntimeProto`)
- Atoms made from a runtime (`runtime.atom`, `runtime.fn`, `runtime.pull`, `runtime.subscriptionRef`) first read the runtime atom. While it is not `Success` they show its `Initial`/`Failure` (with their own previous value kept via `AsyncResult.replacePrevious`), so layer build errors (`ER`) are part of every atom's error channel. [E-Atom] (`RuntimeProto`)

### 1.2 Queries

- `query(tag, payload, { headers, reactivityKeys, timeToLive, serializationKey })` builds a plain object key with all of these and calls a single `Atom.family(queryFamily)`. So the atom is shared only when every option is equal too. [E-Rpc] [E-Http]
- `Atom.family` memoizes by `MutableHashMap`, which uses Effect's `Equal`/`Hash`. With `WeakRef`/`FinalizationRegistry` available it holds the atoms weakly and drops entries once the atom is garbage collected; otherwise it holds them forever. [E-Atom] (`family`)
- `Equal.equals` compares plain objects key by key and arrays element by element; objects implementing `Equal` decide for themselves. Gotcha: object-pair results are cached in a `WeakMap`, so key objects must not be mutated after their first comparison. [E-Equal]
- Non-stream RPCs become `runtime.atom(client(tag, payload))`, i.e. `Atom<AsyncResult<A, E>>`. Stream RPCs become `runtime.pull(stream)`, a `Writable<PullResult<A, E>, void>` that pulls one chunk at a time and accumulates items unless `disableAccumulation`. Pull fits paginated or finite streams, not a live snapshot listener whose every emission replaces the last. [E-Rpc] [E-Atom] (`pull`)
- Optional layers on top of the query atom, in this order: `runtime.factory.withReactivity(reactivityKeys)`, `Atom.serializable({ key: "AtomRpc:<tag>:<serializationKey>", schema: AsyncResult.Schema(...) })` (non-stream only), and `timeToLive` → `Atom.setIdleTTL` when finite, `Atom.keepAlive` when infinite. [E-Rpc] [E-Http]

### 1.3 Mutations

- `mutation(tag)` is an `Atom.family` keyed by the tag alone (`AtomHttpApi`: by `{ group, endpoint, responseMode }`). It returns `runtime.fn<{ payload, reactivityKeys?, headers? }>()(...)`, an `AtomResultFn<Arg, A, E>`. The payload and the keys to invalidate are given per call, not per atom. [E-Rpc] [E-Http]
- An `AtomResultFn` is a `Writable<AsyncResult<A, E>, Arg | Reset | Interrupt>`. Writing an argument bumps a counter and re-runs the function; `Reset` returns it to `Initial`; `Interrupt` interrupts the running fiber. By default a new write interrupts the previous run; `concurrent: true` keeps all runs and joins them. [E-Atom] (`makeResultFn`)
- When a call passes `reactivityKeys`, the effect is wrapped in `Reactivity.mutation(effect, keys)`, which invalidates the keys after the effect **succeeds** (never on failure). `runtime.fn(..., { reactivityKeys })` does the same at atom level, and for a Stream it invalidates on stream end. [E-Rpc] [E-React] [E-Atom] (`makeFnRuntime`)
- The mutation atom is also wrapped in `Atom.serializable` under `AtomRpc:mutation:[id, tag]`. [E-Rpc]

### 1.4 `Reactivity`

- A process-local registry of handlers by hashed key. It caches no values. Keys are either an array (`["users"]`) or a record (`{ users: [1, 2] }`); a record registers or invalidates both `users` and `users:<hash(id)>`, so invalidating `{ users: [1] }` reaches handlers on `users` and on `users:1`. Strings, numbers, bigints and booleans hash as their string form; anything else by `Hash.hash`. [E-React] (`keysToHashes`)
- `withBatch` defers handlers until the wrapped effect exits. [E-React]
- `Reactivity.Keys` can be augmented to make keys strict, but its doc says: "Only applications should augment this interface, never libraries." A library that wants typed keys of its own cannot use that mechanism. [E-React]
- `withReactivity(keys)(atom)` registers a handler that calls `get.refresh(atom)`. For an Effect atom that re-runs the effect; for a Stream atom it re-runs the stream. [E-Atom] (`context().withReactivity`)

### 1.5 Lifetime: keep-alive, idle TTL, laziness

- Atoms are disposed when they have no listeners and no dependents, unless `keepAlive` is set (`Atom.keepAlive`; `Atom.autoDispose` undoes it). [E-Atom] [E-Reg] (`canBeRemoved`)
- `Atom.setIdleTTL(duration)` keeps an unused atom alive for that long; an infinite duration means keep-alive, `0` means no TTL. `AtomRegistry.make({ defaultIdleTTL })` sets a TTL for every atom that has none. Re-reading the atom before the TTL fires cancels the removal. [E-Atom] [E-Reg] (`atomHasTtl`, `ensureNode`)
- For a listener-backed atom this is the knob that decides how long the Firestore listener stays attached after the last reader leaves. [inference]

### 1.6 Streams as atoms and `AsyncResult`

- `AsyncResult<A, E>` is `Initial | Success | Failure`, each with a `waiting` flag. `Failure` keeps `previousSuccess`, so a failing refresh still has the last good value. [E-Result]
- `Atom.make(stream)` / `runtime.atom(stream)`: each emitted chunk sets `Success(last, { waiting: true })`. Only when the stream **ends** does it become `Success(last)` with `waiting: false`; a stream that ends with no value becomes `Failure(NoSuchElementError)`; a failure becomes `Failure` with the previous value kept. [E-Atom] (`makeStream`)
- Consequence: a live listener never ends, so an atom built this way reports `waiting: true` forever. If the design wants `waiting` to mean "a write or a refresh is in flight", the read atom needs its own read function (e.g. run the stream and `setSelf(AsyncResult.success(snapshot))`), not `runtime.atom(stream)` as is. [inference]
- `runtime.subscriptionRef` gives a `Writable<AsyncResult<A, E>, A>` backed by a `SubscriptionRef`; writing to the atom writes the ref. [E-Atom]

### 1.7 Optimistic helpers

- `Atom.optimistic(self)` wraps a read atom so it can be written with transition atoms; waiting successes show provisionally, a successful transition refreshes the source, a failed one rolls back. `Atom.optimisticFn({ reducer, fn })` pairs it with an `AtomResultFn`. [E-Atom] (`optimistic`, `optimisticFn`)
- Note that "refreshes the source" would re-attach a listener if the source is a listen atom. [inference]

## 2. What the Firestore SDK already does

- **Listener fan-out.** `EventManager` "is responsible for mapping queries to query event emitters. It handles 'fan-out'. -- Identical queries will re-use the same watch on the backend." It keeps a `QueryListenersInfo` (listeners plus last `viewSnap`) per canonical query in an `ObjectMap`. [SDK-EM]
- **Latency compensation.** "Local writes in your app will invoke snapshot listeners immediately", before the data is sent to the backend; `metadata.hasPendingWrites` "indicates whether the document has local changes that haven't been written to the backend yet." By default listeners are not told about metadata-only changes; `includeMetadataChanges` turns that on. [FB-Listen]
- **Write promises.** `setDoc` "does _not_ resolve until the data is successfully written to the remote Firestore backend ... if the client cannot reach the backend (for example, due to being offline) then the returned `Promise` will not resolve for a potentially-long time." The data is saved to the local cache immediately, and the SDK calls awaiting the promise "usually undesirable". The same note is on the other writes. [SDK-Ref]
- **Offline.** Writes are queued; listeners keep getting events from the cache, which "might be stale or incomplete". [FB-Offline]
- **Errors end a listener.** "After an error, the listener will not receive any more events, and there is no need to detach your listener." [FB-Listen]

## 3. Prior art in Firestore bindings

### 3.1 reactfire (React, rxjs)

- **Live by default.** `useFirestoreDoc` uses rxfire's `doc(ref)`, which is `fromRef(ref, { includeMetadataChanges: true })`, so every pending-write acknowledgement re-emits. One-off variants (`useFirestoreDocOnce`, `…DataOnce`) are the live observable piped through `first()`. [RF] [RX]
- **Snapshot or data.** Two hook families: `useFirestoreDoc`/`useFirestoreCollection` return SDK snapshots; `…Data` variants unwrap to plain objects, optionally with `idField` set from the snapshot id. [RF] [RX]
- **Keys.** Each hook builds a string `observableId`, e.g. `firestore:doc:<firestoreId>:<converter|raw>:<path>` (the Firestore instance gets a small id from a `WeakMap`), or for queries the index of the first cached query that is `queryEqual`. The kind of hook and `idField` are part of the key. [RF] (`getUniqueIdForFirestoreDoc`, `getUniqueIdForFirestoreQuery`)
- **Sharing.** `preloadObservable` keeps one `SuspenseSubject` per id in a `Map` on `globalThis`. The subject wraps the source in `shareReplay(1)` and subscribes to it at once ("warm up"). [RF] (`useObservable.ts`, `SuspenseSubject.ts`)
- **Lifetime.** The subject arms a 30 s timer that resets it if nobody subscribes; `_subscribe` clears the timer, and nothing in the class re-arms it on unsubscribe, so once a component has subscribed, the warm-up subscription keeps the listener attached for the life of the page. [RF] (`SuspenseSubject.ts`)
- **Errors and status.** `ObservableStatus` is `{ status: 'loading' | 'error' | 'success', hasEmitted, isComplete, data, error, firstValuePromise }`. `useObservable` still throws `update.error` (a code comment questions this). With Suspense on, it throws `firstEmission` while there is no value. [RF] (`useObservable.ts`)
- **Writes.** None: reactfire wraps reads only.
- **SSR.** The server snapshot is built from `initialData` only, never from the global cache, to avoid leaking one request's data into another. [RF] (`useObservable.ts`)

### 3.2 TanStack Query Firebase (invertase)

- **v2 (current, `@tanstack-query-firebase/react`).** `useDocumentQuery(ref, options)` and `useCollectionQuery(query, options)` are `useQuery` with a `queryFn` of `getDoc`/`getDocFromServer`/`getDocFromCache` (chosen by `options.firestore.source`). There is no live listener. The **caller supplies `queryKey`**; nothing derives it from the ref. Errors are `FirestoreError` in TanStack's error state. [TQF] (`useDocumentQuery.ts`, `useCollectionQuery.ts`, tests)
- **v2 writes.** One hook per SDK write, bound to a ref at hook time: `useSetDocumentMutation(ref)` with `mutationFn: (data) => setDoc(ref, data)`; likewise add/update/delete, `useRunTransactionMutation`, `useWriteBatchCommitMutation`. They do not invalidate anything themselves. There is also `useWaitForPendingWritesQuery`. [TQF]
- **Data Connect contrast (same repo).** `useDataConnectQuery` derives the query key from the query ref automatically and warns that overriding it may lose "mutation invalidations or server side rendering pre-fetching". `useDataConnectMutation` takes `invalidate: [getMovieRef]` (every cached instance of that query) or `[getMovieRef({ id: "1" })]` (one instance). This is the family-level vs instance-level split that `Reactivity`'s `["users"]` vs `{ users: [1] }` also makes. [TQF] (`docs/react/data-connect/*.mdx`)
- **v1 (legacy `@react-query-firebase/firestore`).** `useFirestoreDocument(queryKey, ref, { subscribe, includeMetadataChanges, source })`. With `subscribe: true`, `useSubscription` keeps module-level maps of unsubscribe functions and observer counts per hashed subscription key, attaches one `onSnapshot` per key, pushes later snapshots with `queryClient.setQueryData`, and detaches when the last observer unmounts. It forces `staleTime: Infinity` and turns off refetching. `onSnapshot` gets no error callback, so listener errors are not surfaced. The docs ask the user to keep the query key in step with the ref. [RQF]

### 3.3 VueFire (Vue)

- **API.** `useDocument(ref)` / `useCollection(query)` return a Vue ref of the data, extended with `data`, `pending`, `error`, `promise` and `stop`. The source can be a ref or getter; a watcher re-binds when it changes, and `null` unbinds. [VF] (`useFirestoreRef.ts`, `docs/guide/realtime-data.md`)
- **Data shape.** Data, not snapshots. The default converter adds a non-enumerable `id`; `snapshotOptions` defaults to `{ serverTimestamps: 'estimate' }` "to avoid `null` values". Nested `DocumentReference`s in the data are bound too, up to `maxRefDepth` (default 2). [VF] (`bind.ts`, docs)
- **Sharing.** None: each call attaches its own `onSnapshot` and detaches on scope dispose. Sharing is left to the SDK. [VF] (`bind.ts`)
- **Once.** `once: true` uses `getDoc`/`getDocs` instead; on the server it is forced on. [VF]
- **Errors.** `onSnapshot(ref, onNext, reject)`: the error goes to the binding's promise and from there to `error`. Since the promise already resolved on the first snapshot, from the source it looks like an error after the first snapshot does not reach `error`. [VF] (`bind.ts`, `useFirestoreRef.ts`) — inferred from reading the code, not tested.
- **Writes.** None: "Vuefire **does not** handle writing data back to Firebase because you can directly use the Firebase JS SDK". [VF] (`old_writing-data.md`)
- **SSR.** `ssrKey` is inferred from the path, must be given for queries, and `ssrKey: false` opts out. Same idea as `AtomRpc`'s `serializationKey`. [VF] (`ssr.md`)

### 3.4 Side by side

|                 | reactfire                                 | TanStack Query Firebase v2             | TQF v1 (legacy)                 | VueFire                  | AtomRpc / AtomHttpApi                   |
| --------------- | ----------------------------------------- | -------------------------------------- | ------------------------------- | ------------------------ | --------------------------------------- |
| Live reads      | yes (only)                                | no                                     | opt-in `subscribe`              | yes, `once` opt-in       | stream RPCs via `pull`                  |
| Key             | derived from ref path + hook kind         | user `queryKey`                        | user `queryKey`                 | none (no cache)          | structural key object via `Atom.family` |
| Shared listener | yes, global map                           | n/a                                    | yes, ref-counted                | no                       | one atom per key per registry           |
| Lifetime        | never detached once used                  | TanStack `gcTime`                      | last observer detaches          | scope dispose            | auto-dispose, `timeToLive`              |
| Value           | snapshot or data(+idField)                | snapshot                               | snapshot                        | data with `id`           | `AsyncResult`                           |
| Pending writes  | via `includeMetadataChanges: true` always | n/a                                    | `includeMetadataChanges` option | not surfaced             | n/a                                     |
| Errors          | thrown                                    | query error                            | dropped for listens             | `error` ref (first load) | `AsyncResult.Failure` typed             |
| Writes          | none                                      | one hook per SDK write, bound to a ref | mutation hooks                  | none                     | `mutation(tag)` family, input per write |
| Invalidation    | none                                      | none (Data Connect: `invalidate`)      | n/a                             | none                     | `reactivityKeys` per call               |

## 4. Where this codebase already stands

- `ClientFirestore` offers `streamDoc(ref, ListenOptions?)` and `streamDocs(collectionRef | collectionGroup, ListenOptions?)`. `ListenOptions` is `{ includeMetadataChanges?, source?: "default" | "cache" }`. Every snapshot carries `metadata` (**Snapshot Metadata**: `fromCache`, `hasPendingWrites`). [Repo] (`ClientFirestore.ts`)
- Both streams come from `Firestore.streamFromListener` over the SDK's `onSnapshot`: each run attaches its own listener, never ends on its own, drops a snapshot not pulled before the next arrives, and fails with `FirestoreError` (code from `FirebaseError.code`) when the listener errors. A **Collection Group** listen can also fail with `UndefinedCollectionError` on a document at a path no member defines. [Repo] (`Firestore.ts`, `internal/firestore.ts`)
- `DocumentReference` and `CollectionReference` implement `Equal`/`Hash` by `path` and the identity of their collection definition (`Hash.random(collection)`), so `Atom.family(ref => …)` shares one atom per document. A **Collection Group** is a defined value, used by identity. [Repo] (`internal/collection.ts`)
- Writes (`setDoc`, `updateDoc`, `addDoc`, `runTransaction`) are Effects over the SDK promises, so they inherit "does not resolve until the backend has it". [Repo] [SDK-Ref]
- The client SDK cannot abort a request in flight, so interrupting a mutation atom's fiber (`Interrupt`, or a newer write on a non-concurrent `AtomResultFn`) does not stop the write. [Repo] (`ClientFirestore` doc)

## 5. Patterns for #213 to choose between

Each item is a choice the prototype has to make; the options are what the sources above offer.

1. **Entry point.**
   - (a) A service class à la `AtomRpc.Service<Self>()(id, { layer })` with `runtime`, read helpers and `mutation` statics. Fits Effect's precedent; the layer would provide **Client Firestore** (which needs the `App`).
   - (b) Plain functions that take an `AtomRuntime<ClientFirestore>` the app already has.
   - (c) A module-level runtime the library builds itself. Hides the layer but fixes the configuration.
2. **Read atom key.**
   - (a) The typed reference itself (`DocumentReference`, `CollectionReference`, **Collection Group**), plus `ListenOptions`, as a structural family key. Works today because references are `Equal`.
   - (b) A derived string key (reactfire's path-based id). Needed anyway for serialization/SSR keys (VueFire's inferred `ssrKey`, AtomRpc's `serializationKey`).
   - (c) A user-supplied key (TanStack). Every binding that did this had to document "keep the key in step with the ref".
3. **One atom per read kind, or options in the key.** AtomRpc puts every option in one key object, so `{ includeMetadataChanges: true }` and the default get separate atoms (and separate SDK listeners, though the SDK shares the watch). reactfire instead makes separate hooks per kind (`Doc` vs `DocData`, `Once`).
4. **What the atom holds.**
   - (a) `AsyncResult<ClientDocumentSnapshot | ClientQuerySnapshot, FirestoreError | …>`, keeping **Snapshot Metadata** (reactfire `useFirestoreDoc`, TQF).
   - (b) Decoded data only (reactfire `…Data`, VueFire), with a `Missing` document as `undefined`/`Option`/failure.
   - (c) Both, as a derived `Atom.map` over (a).
5. **Stream into atom.**
   - (a) `runtime.atom(streamDoc(ref))`: least code, but `waiting` stays `true` for as long as the listen runs.
   - (b) A custom read that runs the stream and `setSelf`s plain `Success` values, so `waiting` is free to mean something else.
   - (c) `runtime.subscriptionRef`. (`runtime.pull` fits pagination, not live snapshots.)
6. **Listener lifetime.**
   - (a) Effect default: detach when the last reader leaves, with an optional per-atom `timeToLive` → `setIdleTTL` / `keepAlive` (AtomRpc), or a registry-wide `defaultIdleTTL`.
   - (b) Never detach once used (reactfire).
   - (c) Ref-counted per consumer (TQF v1) is what (a) already gives.
7. **Mutation shape.**
   - (a) One `AtomResultFn` per operation (`setDoc`, `updateDoc`, `addDoc`, transaction), family keyed by the operation, with `{ ref, data }` per write (AtomRpc).
   - (b) One per reference (TanStack's `useSetDocumentMutation(ref)`), family keyed by `(operation, ref)`; gives a per-document `AsyncResult` but many atoms.
   - Either way: `concurrent` or not (a newer write interrupts the older fiber but cannot stop the SDK request), and the `AsyncResult` stays `waiting` until the server acknowledges, possibly a long time offline.
8. **Invalidation.**
   - (a) None for live reads: the listener already reflects local writes; `withReactivity` would only re-attach listeners.
   - (b) `reactivityKeys` per write (AtomRpc) or per atom (`runtime.fn`), only for one-off reads if those exist (see #210 "One-off reads"). Library-defined keys cannot use `Reactivity.Keys` augmentation, so they would be untyped or path-derived (family form `collection`, instance form `{ collection: [path] }`, mirroring Data Connect's `getMovieRef` vs `getMovieRef({ id })`).
9. **Pending writes.**
   - (a) Expose **Snapshot Metadata** on the snapshot and let readers check `hasPendingWrites`; pick whether `includeMetadataChanges` defaults on (rxfire: always on) or off (SDK default, VueFire).
   - (b) Layer `Atom.optimistic`/`optimisticFn` on top; note its "refresh the source on success" step would re-attach a listener.
10. **Errors.**
    - (a) `AsyncResult.Failure` with typed `FirestoreError | UndefinedCollectionError`, keeping `previousSuccess` (Effect default). Since the SDK listener is dead after an error, recovering needs a refresh, by the reader or automatically.
    - (b) Throw (reactfire) or (c) a side `error` field (VueFire). Both lose type information that (a) keeps.
