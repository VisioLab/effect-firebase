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
A **Transaction** that can also read every document in a collection.

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
A value as Firestore stores it, independent of either SDK: a scalar, a timestamp, a geopoint, a document reference, bytes, a sentinel, or an array or map of Firestore Values.
_Avoid_: encoded value, SDK value, raw value
