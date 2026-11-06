/**
 * The Callables the fixture serves, shared with the tests that call them.
 *
 * Imports only the portable core, as an app's shared contract would.
 */
import { Schema } from "effect";
import * as Callable from "@visiolab/effect-firebase/functions/Callable";
import * as CallableGroup from "@visiolab/effect-firebase/functions/CallableGroup";

/** A Callable in no group, with a `Date` each way. */
export const Greet = Callable.make("greet", {
  payload: { name: Schema.String, at: Schema.Date },
  success: Schema.Struct({ message: Schema.String, nextDay: Schema.Date }),
});

/** Answers with how often its Layer was built in the serving process. */
export const LayerBuilds = Callable.make("layerBuilds", {
  success: Schema.Struct({ builds: Schema.Finite }),
});

/** A user, with a `Date` that must survive the wire. */
export const User = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  birthday: Schema.Date,
});

export const CreateUser = Callable.make("create", {
  payload: { name: Schema.String, birthday: Schema.Date },
  success: User,
});

/** In both `users` and `admins`: answers which group served it. */
export const GetUser = Callable.make("get", {
  payload: { id: Schema.String },
  success: Schema.Struct({ id: Schema.String, servedBy: Schema.String }),
});

/** Served in `europe-west1`, through the options of its group's export. */
export const DeleteUser = Callable.make("delete", { payload: { id: Schema.String } });

export class Users extends CallableGroup.make("users").add(CreateUser, GetUser, DeleteUser) {}

export class Admins extends CallableGroup.make("admins").add(GetUser) {}

/** What a member of `workers` answers: the worker that built its Layer, and how often. */
const BuiltBy = Schema.Struct({ target: Schema.String, builds: Schema.Finite });

/** Two members that share one Layer, to show each worker builds it for itself. */
export class Workers extends CallableGroup.make("workers").add(
  Callable.make("first", { success: BuiltBy }),
  Callable.make("second", { success: BuiltBy }),
) {}

/** Opens a span of its own, tagged with the call's id, so a test can find the call's server span. */
export const Traced = Callable.make("traced", { payload: { callId: Schema.String } });

/** Serves {@link Traced} as `tracing-traced`, with a Layer whose build opens a span. */
export class Tracing extends CallableGroup.make("tracing").add(Traced) {}
