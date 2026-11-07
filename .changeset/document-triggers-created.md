---
"@visiolab/effect-firebase": minor
"@visiolab/effect-firebase-functions": minor
---

Add Document Triggers, starting with `created`: server functions that run when a document of a collection is created.

- `DocumentTrigger.created(name, collection)` (`@visiolab/effect-firebase/functions`) declares a trigger from a name and a `Collection` definition, with no `firebase-functions` import. Its handler gets an event with the created document as an existing Document Snapshot (`snapshot`), its typed Document Reference (`ref`, whose `ancestors` and `id` hold the path's ids), and the CloudEvent's `id` and `time`. `snapshot.data` decodes through the collection's model when it runs.
- `DocumentTrigger.toLayer(trigger, handler | Effect<handler>)` implements a trigger, and `DocumentTrigger.serve(trigger)` runs an event through its handler in process. Build test events with `DocumentTrigger.createdEvent` and `DocumentSnapshot.existing`.
- `Functions.make` deploys a Document Trigger with `onDocumentCreated` on the `(default)` database, at a path pattern derived from the collection. Its options are the shared `firebase-functions` options plus `retry`; `document`, `database`, `namespace` and the event filter options are not exposed. A failing handler is logged and makes the function throw.
- `@visiolab/effect-firebase-functions` now takes `@visiolab/effect-firebase-admin` and `firebase-admin` as peer dependencies, to read event data into Firestore Values as the Admin SDK reads do.

Firebase delivers each event at least once, so make handlers idempotent, keyed on the event's `id`.
