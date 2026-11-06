// PROTOTYPE, throwaway. The shared contract: what an app would put in a package
// both its functions and its web client import.
import { Schema } from "effect";
import * as Callable from "./core.ts";

export class User extends Schema.Class<User>("User")({
  id: Schema.String,
  name: Schema.String,
  birthday: Schema.Date,
  createdBy: Schema.String,
}) {}

export class NameTaken extends Schema.TaggedError<NameTaken>()(
  "NameTaken",
  { name: Schema.String },
  { callableErrorCode: "already-exists" },
) {}

export const CreateUser = Callable.make("create", {
  payload: { name: Schema.String, birthday: Schema.Date },
  success: User,
  error: NameTaken,
});

export const GetUser = Callable.make("get", {
  payload: { id: Schema.String },
  success: User,
  error: Callable.NotFound,
});

// Sleeps for `ms`, to try client aborts and SIGTERM mid-call.
export const Slow = Callable.make("slow", {
  payload: { ms: Schema.Number },
  success: Schema.Number,
});

export const Users = Callable.group("users")
  .add(CreateUser, GetUser, Slow)
  .middleware(Callable.Authenticated);

export const Greet = Callable.make("greet", {
  payload: { name: Schema.String },
  success: Schema.Struct({ text: Schema.String, at: Schema.Date }),
});
