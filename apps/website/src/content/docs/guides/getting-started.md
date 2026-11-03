---
title: Getting started
description: Install Effect Firebase and run a first program.
---

Effect Firebase comes as three packages:

- `@visiolab/effect-firebase` defines the services and the typed Firestore
  collections, independent of any Firebase SDK.
- `@visiolab/effect-firebase-admin` implements them on the Firebase Admin SDK.
- `@visiolab/effect-firebase-client` implements them on the Firebase client SDK.

```sh
pnpm add effect @visiolab/effect-firebase @visiolab/effect-firebase-admin firebase-admin
```
