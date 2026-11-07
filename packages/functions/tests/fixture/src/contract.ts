/**
 * The Callables the fixture serves, shared with the tests that call them.
 *
 * Imports only the portable core, as an app's shared contract would.
 */
import { Schema } from "effect";
import * as Callable from "@visiolab/effect-firebase/functions/Callable";
import * as CallableError from "@visiolab/effect-firebase/functions/CallableError";
import * as CallableGroup from "@visiolab/effect-firebase/functions/CallableGroup";
import * as CallableMiddleware from "@visiolab/effect-firebase/functions/CallableMiddleware";
import * as Caller from "@visiolab/effect-firebase/functions/Caller";

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

/** Answers with the uid of the Caller that group middleware provides. */
export const Me = Callable.make("me", { success: Schema.String });

/**
 * {@link GetUser} again, behind `Authenticated` as group middleware, and
 * {@link Me}, added after the middleware.
 */
export class Accounts extends CallableGroup.make("accounts")
  .add(GetUser)
  .middleware(Caller.Authenticated)
  .add(Me) {}

/** What a member of `workers` answers: the worker that built its Layer, and how often. */
const BuiltBy = Schema.Struct({ target: Schema.String, builds: Schema.Finite });

/** Two members that share one Layer, to show each worker builds it for itself. */
export class Workers extends CallableGroup.make("workers").add(
  Callable.make("first", { success: BuiltBy }),
  Callable.make("second", { success: BuiltBy }),
) {}

/** A declared error whose code its own annotations set. */
export class NameTaken extends Schema.TaggedError<NameTaken, { readonly brand: unique symbol }>()(
  "NameTaken",
  { username: Schema.String, since: Schema.Date },
  { callableErrorCode: "already-exists" },
) {}

/** A declared error that gets its code from `Callable.errorCode`. */
export class Banned extends Schema.TaggedError<Banned, { readonly brand: unique symbol }>()(
  "Banned",
  { message: Schema.String },
) {}

/** A declared error without a code, so it is sent as `internal`. */
export class Unexplained extends Schema.TaggedError<
  Unexplained,
  { readonly brand: unique symbol }
>()("Unexplained", {}) {}

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

/** `Fail` again, as a member of a group, deployed as `failing-fail`. */
export class Failing extends CallableGroup.make("failing").add(Fail) {}

/** Greets the signed-in Caller by uid, behind `Authenticated`. */
export const WhoAmI = Callable.make("whoAmI", {
  payload: { greeting: Schema.String },
  success: Schema.String,
}).middleware(Caller.Authenticated);

/** Opens a span of its own, tagged with the call's id, so a test can find the call's server span. */
export const Traced = Callable.make("traced", { payload: { callId: Schema.String } });

/** Serves {@link Traced} as `tracing-traced`, with a Layer whose build opens a span. */
export class Tracing extends CallableGroup.make("tracing").add(Traced) {}

/** Logs twice, with a pause between, annotated with the call's id. */
export const Logged = Callable.make("logged", { payload: { callId: Schema.String } });

/** Its Layer always fails to build. */
export const BrokenBuild = Callable.make("brokenBuild");

/** Logs each call it wraps, and logs again when that call fails. */
export class Audit extends CallableMiddleware.Service<Audit>()("Audit") {}

/** `Audit` outside `Authenticated`, so `Audit` logs the rejection of a signed-out call. */
export const Audited = Callable.make("audited", { payload: { callId: Schema.String } })
  .middleware(Caller.Authenticated)
  .middleware(Audit);
