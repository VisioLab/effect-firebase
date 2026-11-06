/**
 * The Callables the fixture serves, shared with the tests that call them.
 *
 * Imports only the portable core, as an app's shared contract would.
 */
import { Schema } from "effect";
import * as Callable from "@visiolab/effect-firebase/functions/Callable";

/** A Callable in no group, with a `Date` each way. */
export const Greet = Callable.make("greet", {
  payload: { name: Schema.String, at: Schema.Date },
  success: Schema.Struct({ message: Schema.String, nextDay: Schema.Date }),
});

/** Answers with how often its Layer was built in the serving process. */
export const LayerBuilds = Callable.make("layerBuilds", {
  success: Schema.Struct({ builds: Schema.Finite }),
});
