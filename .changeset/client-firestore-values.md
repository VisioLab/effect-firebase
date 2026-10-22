---
"@visiolab/effect-firebase-client": minor
"@visiolab/effect-firebase": minor
---

Client Firestore now writes and reads documents as Firestore Values. A write
is encoded through `FirestoreValue.toCodecFirestore` on the collection's model,
then mapped to the client SDK's own values. A read is mapped from the SDK's
values, then decoded. So a plain model works as it is:

```ts
class Event extends FirestoreModel.Class<Event>("Event")({
  at: Schema.DateTimeUtc, // stored as a Firestore timestamp
  on: Schema.Date, // stored as a Firestore timestamp
  payload: Schema.Uint8Array, // stored as bytes
  note: Schema.Option(Schema.String),
}) {}
```

`DocumentSnapshot`'s `data` now decodes through the derived codec as well.

Reading a document that holds a value outside the Firestore Value union, such
as a vector, fails with a `FirestoreError` that names the field.

The new `ClientFirestoreValue` module exports the mapping, for writes made
through the raw SDK:

```ts
import { ClientFirestoreValue } from "@visiolab/effect-firebase-client/firestore";
import { FirestoreValue } from "@visiolab/effect-firebase/firestore";
import { doc, setDoc } from "firebase/firestore";

const encoded = Schema.encodeSync(FirestoreValue.toCodecFirestore(Event))(event);
await setDoc(doc(firestore, "events/e"), ClientFirestoreValue.toSdkValue(firestore, encoded));
```

`ClientFirestoreValue.fromSdkValue` goes the other way. It returns a `Result`
that fails with `UnsupportedSdkValue` for a value outside the union.

Existing models that use `FirestoreSchema` codecs keep working unchanged.
