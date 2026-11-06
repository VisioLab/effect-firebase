// PROTOTYPE, throwaway. The functions entry point firebase-tools loads.
import { Context, Effect, Layer, Ref } from "effect";
import * as Callable from "./core.ts";
import * as CallableFunction from "./server.ts";
import { CreateUser, GetUser, Greet, NameTaken, Slow, User, Users } from "./contract.ts";

console.log(
  "[prototype] module load",
  JSON.stringify({
    FUNCTION_TARGET: process.env.FUNCTION_TARGET,
    K_SERVICE: process.env.K_SERVICE,
    FUNCTION_SIGNATURE_TYPE: process.env.FUNCTION_SIGNATURE_TYPE,
    FUNCTIONS_CONTROL_API: process.env.FUNCTIONS_CONTROL_API,
    FUNCTIONS_EMULATOR: process.env.FUNCTIONS_EMULATOR,
    PORT: process.env.PORT,
    pid: process.pid,
  }),
);

// An in-memory store with a slow finalizer, to see whether SIGTERM disposal runs.
class Store extends Context.Service<Store, Ref.Ref<ReadonlyMap<string, User>>>()("Store") {
  static layer = Layer.effect(
    Store,
    Effect.gen(function* () {
      yield* Effect.log("[prototype] building Store");
      yield* Effect.addFinalizer(() =>
        Effect.log("[prototype] Store finalizer start").pipe(
          Effect.andThen(Effect.sleep("2 seconds")),
          Effect.andThen(Effect.log("[prototype] Store finalizer done")),
        ),
      );
      return yield* Ref.make<ReadonlyMap<string, User>>(new Map());
    }),
  );
}

const CreateUserLive = Callable.toLayer(CreateUser, ({ name, birthday }) =>
  Effect.gen(function* () {
    const caller = yield* Callable.Caller;
    const store = yield* Store;
    const users = yield* Ref.get(store);
    if ([...users.values()].some((u) => u.name === name)) return yield* new NameTaken({ name });
    const user = new User({ id: `u${users.size + 1}`, name, birthday, createdBy: caller.uid });
    yield* Ref.update(store, (m) => new Map(m).set(user.id, user));
    return user;
  }),
);

const GetUserLive = Callable.toLayer(
  GetUser,
  Effect.gen(function* () {
    const store = yield* Store;
    return ({ id }) =>
      Ref.get(store).pipe(
        Effect.flatMap((users) => {
          const user = users.get(id);
          return user ? Effect.succeed(user) : Effect.fail(new Callable.NotFound({ message: `No user ${id}` }));
        }),
      );
  }),
);

const SlowLive = Callable.toLayer(Slow, ({ ms }) =>
  Effect.sleep(ms).pipe(
    Effect.as(ms),
    Effect.onInterrupt(() => Effect.log(`[prototype] slow(${ms}) interrupted`)),
  ),
);

const UsersLive = Layer.mergeAll(CreateUserLive, GetUserLive, SlowLive).pipe(Layer.provide(Store.layer));

export const { users } = CallableFunction.group(Users, UsersLive, { slow: { timeoutSeconds: 120 } });

export const { greet } = CallableFunction.make(
  Greet,
  Callable.toLayer(Greet, ({ name }) => Effect.succeed({ text: `Hello, ${name}`, at: new Date() })),
);
