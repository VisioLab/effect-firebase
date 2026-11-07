import * as Callable from "@visiolab/effect-firebase/functions/Callable";
import * as CallableError from "@visiolab/effect-firebase/functions/CallableError";
import * as FunctionGroup from "@visiolab/effect-firebase/functions/FunctionGroup";
import * as Caller from "@visiolab/effect-firebase/functions/Caller";
import { Effect, type Layer, Schema } from "effect";
import { describe, expect, test } from "tstyche";

const CreateUser = Callable.make("create", {
  payload: { name: Schema.String },
  success: Schema.String,
});
const DeleteUser = Callable.make("delete", { payload: { id: Schema.String } });
const GetUser = Callable.make("get", { payload: { id: Schema.String }, success: Schema.String });

class Users extends FunctionGroup.make("users").add(CreateUser, DeleteUser, GetUser) {}
class Orders extends FunctionGroup.make("orders").add(GetUser) {}

describe("FunctionGroup.make", () => {
  test("keeps the identifier as a literal type", () => {
    expect(Users.identifier).type.toBe<"users">();
  });

  test("collects the members added", () => {
    expect<FunctionGroup.Members<typeof Users>>().type.toBe<
      typeof CreateUser | typeof DeleteUser | typeof GetUser
    >();
    expect<FunctionGroup.Names<typeof Users>>().type.toBe<"create" | "delete" | "get">();
  });

  test("adding to a class adds to the group", () => {
    const More = Orders.add(CreateUser);
    expect<FunctionGroup.Names<typeof More>>().type.toBe<"get" | "create">();
  });

  test("a group can't be added to a group", () => {
    // @ts-expect-error not assignable
    FunctionGroup.make("all").add(Users);
  });
});

describe("Callable.toLayer with a group", () => {
  test("provides the handler of the member, keyed by the group", () => {
    const layer = Callable.toLayer(Users, "create", ({ name }) => Effect.succeed(name));
    expect(layer).type.toBe<Layer.Layer<Callable.Handler<"users", "create">>>();
  });

  test("a name that isn't a member is a type error", () => {
    // @ts-expect-error not assignable
    Callable.toLayer(Users, "update", () => Effect.void);
  });

  test("the handler of users.get is not one of orders.get", () => {
    const layer = Callable.toLayer(Users, "get", ({ id }) => Effect.succeed(id));
    expect(layer).type.not.toBeAssignableTo<Layer.Layer<Callable.Handler<"orders", "get">>>();
  });

  test("the handler of a standalone Callable is not one of a group member", () => {
    const layer = Callable.toLayer(GetUser, ({ id }) => Effect.succeed(id));
    expect(layer).type.not.toBeAssignableTo<Layer.Layer<Callable.Handler<"users", "get">>>();
  });

  test("the handler is typed by the member", () => {
    // @ts-expect-error Property 'id' does not exist
    Callable.toLayer(Users, "create", ({ id }) => Effect.succeed(id));
  });
});

describe("FunctionGroup middleware", () => {
  test("a group has no middleware", () => {
    // @ts-expect-error Property 'middleware' does not exist
    FunctionGroup.make("signed").middleware(Caller.Authenticated);
  });

  test("a member is the Callable as declared, with its own middleware", () => {
    const Me = Callable.make("me", { success: Schema.String }).middleware(Caller.Authenticated);
    class Accounts extends FunctionGroup.make("accounts").add(Me) {}
    expect<FunctionGroup.Member<typeof Accounts, "me">>().type.toBe<typeof Me>();
    expect<
      Callable.Error<FunctionGroup.Member<typeof Accounts, "me">>
    >().type.toBe<CallableError.Unauthenticated>();
  });
});

// A Function of a kind other than Callable, standing in for a Document Trigger.
const OnSignUp = { kind: "Other", name: "onSignUp" } as const;

class Mixed extends FunctionGroup.make("mixed").add(CreateUser, OnSignUp) {}

describe("FunctionGroup with members of different kinds", () => {
  test("collects the members of every kind", () => {
    expect<FunctionGroup.Names<typeof Mixed>>().type.toBe<"create" | "onSignUp">();
  });

  test("narrows to the members of one kind", () => {
    expect<FunctionGroup.Members<typeof Mixed, Callable.Any>>().type.toBe<typeof CreateUser>();
    expect<FunctionGroup.Names<typeof Mixed, Callable.Any>>().type.toBe<"create">();
    expect<FunctionGroup.Member<typeof Mixed, "onSignUp", Callable.Any>>().type.toBe<never>();
  });

  test("Callable.toLayer takes only a Callable member's name", () => {
    expect(Callable.toLayer(Mixed, "create", ({ name }) => Effect.succeed(name))).type.toBe<
      Layer.Layer<Callable.Handler<"mixed", "create">>
    >();
    // @ts-expect-error not assignable
    Callable.toLayer(Mixed, "onSignUp", () => Effect.void);
  });
});
