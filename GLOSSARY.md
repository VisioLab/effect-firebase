# effect-firebase

Effect services over the Firebase Admin and client SDKs, with a portable core that code can be written against once and run on either.

## Language

### Services

**Firestore**:
The portable Firestore service: only what both SDKs can do, with the same meaning on each. Unqualified, it always means this one.
_Avoid_: core Firestore, generic Firestore, base Firestore

**Admin Firestore**:
A **Firestore** that also offers what only the Admin SDK can do.
_Avoid_: SDK Firestore, server Firestore

**Client Firestore**:
A **Firestore** that also offers what only the client SDK can do.
_Avoid_: SDK Firestore, web Firestore

**Portable code**:
Code that asks only for **Firestore** and so runs against either SDK.
_Avoid_: generic code, shared code

**Transaction**:
The portable reads and writes a single Firestore transaction is made of, as handed to its body.

**Admin Transaction**:
A **Transaction** that can also read every document in a collection or a **Collection Group**.

### Collections

**Collection Group**:
The collections the model defines under one collection id, wherever each sits, read together as one. Each document read through it still belongs to the one collection it lives in.
_Avoid_: group query, all collections named X

### Reads

**Document Snapshot**:
What reading one document hands back: either an existing document or a missing one.

**Query Snapshot**:
What reading many documents at once hands back, holding the documents as one result.
_Avoid_: document list, docs array

**Snapshot Metadata**:
What the client SDK reports about where a snapshot came from: whether it was served from the local cache, and whether it reflects writes not yet acknowledged by the server.

### Values

**Firestore Value**:
A value as Firestore stores it, independent of either SDK: a scalar, a timestamp, a geopoint, a **Document Path**, bytes, a sentinel, or an array or map of Firestore Values.
_Avoid_: encoded value, SDK value, raw value

**Document Reference**:
A reference to a document in a collection the model defines, and so typed by what that document holds. It is not a **Firestore Value**: Firestore stores it as its **Document Path**.

**Document Path**:
A reference to a document as Firestore stores it: the document's path and nothing else, saying nothing of what the document holds.
_Avoid_: untyped reference, reference value, raw reference

### Writes

**Shared Field**:
A field every member of a union holds, and so one a document holding the union can be patched at without knowing which member it holds, with a value every member accepts and stores the same way.
_Avoid_: common field

### Callables

**Callable**:
A server function the client calls by name, declared once as its name, its **Payload**, what it succeeds with and the errors it can fail with. Its name is unique within its **Callable Group**. A Callable in no group is deployed under its own name.
_Avoid_: rpc, endpoint, callable function (for the declaration)

**Callable Group**:
A named set of **Callables** whose functions deploy under the group's name as a prefix. A Callable may be added to more than one group, and each group serves and implements it separately. **Callable Middleware** attached to a group applies to all its Callables. Groups do not nest.
_Avoid_: api, router, namespace

**Payload**:
What the client sends when calling a **Callable**.
_Avoid_: request, input, data

**Callable Handler**:
What runs on the server to answer calls to one **Callable**.
_Avoid_: implementation, resolver

**Callable Function**:
The deployed Firebase function that serves exactly one **Callable**.
_Avoid_: cloud function, onCall export

**Callable Client**:
What the app uses to call the **Callables** of one **Callable Group**, or one Callable in no group, all in one region.
_Avoid_: stub, proxy, rpc client

**Callable Middleware**:
What runs around every call to the **Callables** it is attached to, before the **Payload** is read. It can reject the call, or tell the **Callable Handler** more about it, and the errors it can fail with are part of each Callable it is attached to.
_Avoid_: guard, interceptor

**Caller**:
The signed-in user making a call to a **Callable**.
_Avoid_: user, current user, auth
