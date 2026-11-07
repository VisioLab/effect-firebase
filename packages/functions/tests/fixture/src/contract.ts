/**
 * The Callables and Document Triggers the fixture serves, shared with the
 * tests that call them or write the documents they watch.
 *
 * Imports only the portable core, as an app's shared contract would, except
 * for the type of the request `Audit` requires.
 */
import { Schema } from "effect";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import * as Callable from "@visiolab/effect-firebase/functions/Callable";
import * as CallableError from "@visiolab/effect-firebase/functions/CallableError";
import * as DocumentTrigger from "@visiolab/effect-firebase/functions/DocumentTrigger";
import * as FunctionGroup from "@visiolab/effect-firebase/functions/FunctionGroup";
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

export class Users extends FunctionGroup.make("users").add(CreateUser, GetUser, DeleteUser) {}

export class Admins extends FunctionGroup.make("admins").add(GetUser) {}

/** Answers with the uid of the Caller that `Authenticated` provides. */
export const Me = Callable.make("me", { success: Schema.String }).middleware(Caller.Authenticated);

/**
 * {@link GetUser} again, behind `Authenticated`, and {@link Me}. A group
 * carries no middleware, so each member attaches its own.
 */
export class Accounts extends FunctionGroup.make("accounts").add(
  GetUser.middleware(Caller.Authenticated),
  Me,
) {}

/** What a member of `workers` answers: the worker that built its Layer, and how often. */
const BuiltBy = Schema.Struct({ target: Schema.String, builds: Schema.Finite });

/** Two members that share one Layer, to show each worker builds it for itself. */
export class Workers extends FunctionGroup.make("workers").add(
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

/** A declared error the server sends as `deadline-exceeded`. */
export class TooSlow extends Schema.TaggedError<TooSlow, { readonly brand: unique symbol }>()(
  "TooSlow",
  {},
  { callableErrorCode: "deadline-exceeded" },
) {}

/** Fails the way its Payload asks: with a declared error, a defect or an interrupt. */
export const Fail = Callable.make("fail", {
  payload: {
    with: Schema.Literals([
      "NameTaken",
      "Banned",
      "Unexplained",
      "NotFound",
      "TooSlow",
      "defect",
      "interrupt",
    ]),
  },
  error: [
    NameTaken,
    Banned.pipe(Callable.errorCode("permission-denied")),
    Unexplained,
    CallableError.NotFound,
    TooSlow,
  ],
});

/** Sleeps for as long as its Payload asks, then answers. */
export const Sleep = Callable.make("sleep", { payload: { millis: Schema.Finite } });

/** Its Layer fails to build the first time, and answers with how often it was built. */
export const Flaky = Callable.make("flaky", {
  success: Schema.Struct({ builds: Schema.Finite }),
});

/** `Fail` again, as a member of a group, deployed as `failing-fail`. */
export class Failing extends FunctionGroup.make("failing").add(Fail) {}

/** Greets the signed-in Caller by uid, behind `Authenticated`. */
export const WhoAmI = Callable.make("whoAmI", {
  payload: { greeting: Schema.String },
  success: Schema.String,
}).middleware(Caller.Authenticated);

/** Opens a span of its own, tagged with the call's id, so a test can find the call's server span. */
export const Traced = Callable.make("traced", { payload: { callId: Schema.String } });

/** Serves {@link Traced} as `tracing-traced`, with a Layer whose build opens a span. */
export class Tracing extends FunctionGroup.make("tracing").add(Traced) {}

/** Logs twice, with a pause between, annotated with the call's id. */
export const Logged = Callable.make("logged", { payload: { callId: Schema.String } });

/** Its Layer always fails to build. */
export const BrokenBuild = Callable.make("brokenBuild");

/**
 * Logs each call it wraps, with a header and the caller's address from the
 * call's HTTP request, and logs again when that call fails.
 */
export class Audit extends CallableMiddleware.Service<Audit>()("Audit") {}

/** `Audit` outside `Authenticated`, so `Audit` logs the rejection of a signed-out call. */
export const Audited = Callable.make("audited", { payload: { callId: Schema.String } })
  .middleware(Caller.Authenticated)
  .middleware(Audit);

/** Answers with the `X-Test-Tag` header of the call's HTTP request, read by its handler. */
export const RequestHeader = Callable.make("requestHeader", {
  success: Schema.NullOr(Schema.String),
});

/** An author, the parent document of {@link Posts}. */
export class Author extends FirestoreModel.Class<Author>("Author")({ name: Schema.String }) {}

/** A post, with a Timestamp the model decodes into a `DateTime.Utc`. */
export class Post extends FirestoreModel.Class<Post>("Post")({
  title: Schema.String,
  publishedAt: FirestoreModel.Timestamp(Schema.DateTimeUtc),
}) {}

export const Authors = Collection.make("authors", Author);

/** The posts under each author. */
export const Posts = Authors.subcollection("posts", Post);

/** Records each post created under any author. */
export const OnPostCreated = DocumentTrigger.created("onPostCreated", Posts);

/** A task, which tells the trigger that handles it how its first attempt ends. */
export class Task extends FirestoreModel.Class<Task>("Task")({
  firstAttempt: Schema.Literals(["succeed", "fail", "die", "interrupt"]),
}) {}

export const Tasks = Collection.make("tasks", Task);

/**
 * Ends its first attempt at each task the way the task asks, and succeeds on
 * any later one. Deployed with `retry`, so Firebase delivers a failed event
 * again.
 */
export const OnTaskCreated = DocumentTrigger.created("onTaskCreated", Tasks);
