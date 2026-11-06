/**
 * The Callables the fixture serves, shared with the tests that call them.
 *
 * Imports only the portable core, as an app's shared contract would.
 */
import { Schema } from "effect";
import * as Callable from "@visiolab/effect-firebase/functions/Callable";
import * as CallableError from "@visiolab/effect-firebase/functions/CallableError";

/** A Callable in no group, with a `Date` each way. */
export const Greet = Callable.make("greet", {
  payload: { name: Schema.String, at: Schema.Date },
  success: Schema.Struct({ message: Schema.String, nextDay: Schema.Date }),
});

/** Answers with how often its Layer was built in the serving process. */
export const LayerBuilds = Callable.make("layerBuilds", {
  success: Schema.Struct({ builds: Schema.Finite }),
});

/** A declared error whose code its own annotations set. */
export class NameTaken extends Schema.TaggedError<NameTaken>()(
  "NameTaken",
  { name: Schema.String, since: Schema.Date },
  { callableErrorCode: "already-exists" },
) {}

/** A declared error that gets its code from `Callable.errorCode`. */
export class Banned extends Schema.TaggedError<Banned>()("Banned", {
  message: Schema.String,
}) {}

/** A declared error without a code, so it is sent as `internal`. */
export class Unexplained extends Schema.TaggedError<Unexplained>()("Unexplained", {}) {}

/** Fails the way its Payload asks: with a declared error, a defect or an interrupt. */
export const Fail = Callable.make("fail", {
  payload: {
    with: Schema.Literals([
      "NameTaken",
      "Banned",
      "Unexplained",
      "NotFound",
      "defect",
      "interrupt",
    ]),
  },
  error: [
    NameTaken,
    Banned.pipe(Callable.errorCode("permission-denied")),
    Unexplained,
    CallableError.NotFound,
  ],
});

/** Its Layer fails to build the first time, and answers with how often it was built. */
export const Flaky = Callable.make("flaky", {
  success: Schema.Struct({ builds: Schema.Finite }),
});
