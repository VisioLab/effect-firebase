---
"@visiolab/effect-firebase": minor
"@visiolab/effect-firebase-functions": minor
---

Add the `updated`, `deleted` and `written` Document Triggers.

- `DocumentTrigger.deleted(name, collection)` hands its handler the document as it was just before it was deleted, as an existing `snapshot`.
- `DocumentTrigger.updated(name, collection)` hands over `before` and `after`, both existing Document Snapshots.
- `DocumentTrigger.written(name, collection)` runs on a create, an update and a delete, and hands over `before` and `after` as Document Snapshots: `before` is `Missing` on a create, and `after` is `Missing` on a delete. Narrow each side with `DocumentSnapshot.isExisting` or `DocumentSnapshot.isMissing`.
- Each event carries `ref`, `id` and `time`, and is built in tests with `DocumentTrigger.deletedEvent`, `updatedEvent` or `writtenEvent`.
- `Functions.make` deploys each with `onDocumentDeleted`, `onDocumentUpdated` or `onDocumentWritten`, and `Functions.DocumentTriggerExport` is the `CloudFunction` of that provider.
