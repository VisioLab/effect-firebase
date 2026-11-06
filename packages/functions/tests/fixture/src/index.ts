/**
 * The functions module the Functions emulator serves to the tests.
 *
 * The root `firebase.json` points its `functions` source at this fixture, and
 * `vp run emulator` bundles it into `dist` before it starts the emulator.
 */
import { onCall } from "firebase-functions/v2/https";

/** Answers with the message it was sent. */
export const echo = onCall<{ readonly message: string }>((request) => ({
  echoed: request.data.message,
}));
