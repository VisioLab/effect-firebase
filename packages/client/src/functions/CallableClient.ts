/**
 * Callable Clients: call the Callables a server serves, with the Payload, the
 * success value and the errors typed by their contract.
 *
 * A client calls through the {@link ClientFunctions.ClientFunctions} in
 * context, so the region and the emulator are set once, where that is
 * provided.
 *
 * @example Calling a Callable
 * ```ts
 * import { Effect, Layer, Schema } from "effect";
 * import { Callable } from "@visiolab/effect-firebase/functions";
 * import { App } from "@visiolab/effect-firebase-client/app";
 * import { CallableClient, ClientFunctions } from "@visiolab/effect-firebase-client/functions";
 *
 * const Greet = Callable.make("greet", {
 *   payload: { name: Schema.String },
 *   success: Schema.String,
 * });
 *
 * const program = Effect.gen(function* () {
 *   const { greet } = yield* CallableClient.make(Greet);
 *   const message = yield* greet({ name: "Ada" });
 *   yield* Effect.log(message);
 * });
 *
 * const FunctionsLive = ClientFunctions.layer().pipe(
 *   Layer.provide(App.layer({ apiKey: "<api key>", projectId: "my-project", appId: "<app id>" })),
 * );
 *
 * program.pipe(Effect.provide(FunctionsLive));
 * ```
 *
 * @stability unstable
 * @since 0.2.0
 */
import { Effect, Schema } from "effect";
import * as Callable from "@visiolab/effect-firebase/functions/Callable";
import * as CallableGroup from "@visiolab/effect-firebase/functions/CallableGroup";
import * as CallableError from "@visiolab/effect-firebase/functions/CallableError";
import * as Sdk from "firebase/functions";
import * as ClientFunctions from "./ClientFunctions.ts";

/**
 * A client of one Callable: a function from its Payload to an Effect of its
 * success value, failing with its declared errors or a `CallableError`.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type Method<C extends Callable.Any> = (
  payload: Callable.Payload<C>,
) => Effect.Effect<Callable.Success<C>, Callable.Error<C> | CallableError.CallableError>;

/**
 * What {@link make} returns: one {@link Method} per Callable, keyed by the
 * Callable's name. For a Callable Group, one per member.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type Client<T extends Callable.Any | CallableGroup.Any> = {
  readonly [C in Members<T> as C["name"]]: Method<C>;
};

/**
 * The Callables a client of `T` calls: the members of a Callable Group, or the
 * Callable itself.
 *
 * @stability unstable
 * @category type-level
 * @since 0.2.0
 */
export type Members<T extends Callable.Any | CallableGroup.Any> = T extends CallableGroup.Any
  ? CallableGroup.Callables<T>
  : T;

const method = (
  functions: Sdk.Functions,
  callable: Callable.Any,
  group: string | undefined,
  deployedName: string,
) => {
  const span = {
    kind: "client",
    attributes: {
      "rpc.system": "firebase_callable",
      "rpc.method": callable.name,
      ...(group === undefined ? {} : { "rpc.service": group }),
      "faas.name": deployedName,
    },
  } as const;
  const call = Sdk.httpsCallable(functions, deployedName);
  const encode = Schema.encodeUnknownEffect(
    Schema.toCodecJson(callable.payload as Schema.Codec<unknown>),
  );
  const decode = Schema.decodeUnknownEffect(
    Schema.toCodecJson(callable.success as Schema.Codec<unknown>),
  );
  const fail = (reason: CallableError.Reason) =>
    new CallableError.CallableError({ callable: deployedName, reason });
  const run = Effect.fn(
    `CallableClient.${deployedName}`,
    span,
  )(function* (payload: unknown) {
    const data = yield* encode(payload).pipe(
      Effect.mapError((cause) => fail(new CallableError.EncodeError({ cause }))),
    );
    const result = yield* Effect.tryPromise({
      try: () => call(data),
      catch: (error) => error,
    }).pipe(Effect.catch(decodeFailure));
    return yield* decode(result.data).pipe(
      Effect.mapError((cause) => fail(new CallableError.DecodeError({ cause }))),
    );
  });

  /**
   * Turns what the SDK threw into the declared error it carries, or into a
   * `CallableError`.
   */
  const decodeFailure = (error: unknown): Effect.Effect<never, unknown> => {
    // No answer arrived: the SDK reports a network failure as status 0.
    if (!(error instanceof Sdk.FunctionsError) || error.message.endsWith(" [0]")) {
      return Effect.fail(fail(new CallableError.TransportError({ cause: error })));
    }
    const code = error.code.replace(/^functions\//, "") as CallableError.ErrorCode;
    const candidates = [...callable.error].filter(
      (schema) => Callable.getErrorCode(schema) === code,
    );
    if (candidates.length === 0 || error.details === undefined) {
      return Effect.fail(
        fail(
          new CallableError.ResponseError({
            code,
            message: error.message.replace(/ \[\d+\]$/, ""),
            details: error.details,
          }),
        ),
      );
    }
    return Schema.decodeUnknownEffect(
      Schema.toCodecJson(Schema.Union(candidates) as unknown as Schema.Codec<unknown>),
    )(error.details).pipe(
      Effect.mapError((cause) => fail(new CallableError.DecodeError({ cause }))),
      Effect.flatMap(Effect.fail),
    );
  };
  return run;
};

/**
 * Builds the client of a Callable in no group, or of every member of a
 * Callable Group.
 *
 * **When to use**
 *
 * Use to call Callables from the browser or any other client SDK program.
 *
 * **Details**
 *
 * Returns a record keyed by Callable name: `const { greet } = yield*
 * CallableClient.make(Greet)` for a Callable in no group, and
 * `const users = yield* CallableClient.make(Users)` for a group, where
 * `users.create` calls `users-create`. The region of the
 * {@link ClientFunctions.ClientFunctions} in context is bound once, here.
 *
 * Build a member's client from its group. A client built from the member on
 * its own calls the name without the group's prefix, which the server doesn't
 * export, and fails with `not-found`. Nothing checks this at runtime.
 *
 * Each call encodes the Payload with `Schema.toCodecJson`, sends it as is
 * through the SDK's `httpsCallable`, and decodes the answer the same way.
 *
 * When the server answers with an error, the client strips the `functions/`
 * prefix from its code and decodes its `details` against the declared errors
 * that carry that code. It fails with the decoded error, so `Effect.catchTag`
 * recovers from it. Every other failure is a
 * {@link CallableError.CallableError}:
 *
 * - `EncodeError` when the Payload doesn't encode. Nothing is sent.
 * - `DecodeError` when the success value doesn't decode, or the `details` of
 *   an error don't decode against the declared errors with its code, as after
 *   the server and the client drift apart.
 * - `ResponseError` when the server answers with a code no declared error
 *   carries, or without details, as on a defect. `not-found` usually means a
 *   wrong region, or a name the server doesn't export, such as a group's
 *   member called without its group.
 * - `TransportError` when no answer arrived.
 *
 * Each call runs in a `kind: "client"` span named `CallableClient.<deployed
 * name>`, such as `CallableClient.users-create`, with the attributes
 * `rpc.system: "firebase_callable"`, `rpc.method` (the Callable's name),
 * `rpc.service` (the group, for a member) and `faas.name` (the deployed name).
 * The span isn't linked to the server's span of the same call: the two land in
 * separate traces. It carries no uid; add one with `Effect.annotateCurrentSpan`
 * around the call when you want it.
 *
 * @example Injecting a client as a service
 * ```ts
 * import { Context, Layer, Schema } from "effect";
 * import { Callable } from "@visiolab/effect-firebase/functions";
 * import { CallableClient } from "@visiolab/effect-firebase-client/functions";
 *
 * const Greet = Callable.make("greet", {
 *   payload: { name: Schema.String },
 *   success: Schema.String,
 * });
 *
 * class GreetClient extends Context.Service<GreetClient, CallableClient.Client<typeof Greet>>()(
 *   "app/GreetClient",
 * ) {
 *   static readonly layer = Layer.effect(GreetClient, CallableClient.make(Greet));
 * }
 * ```
 *
 * @example Calling the members of a group
 * ```ts
 * import { Effect, Schema } from "effect";
 * import { Callable, CallableGroup } from "@visiolab/effect-firebase/functions";
 * import { CallableClient } from "@visiolab/effect-firebase-client/functions";
 *
 * const CreateUser = Callable.make("create", {
 *   payload: { name: Schema.String },
 *   success: Schema.String,
 * });
 *
 * class Users extends CallableGroup.make("users").add(CreateUser) {}
 *
 * const program = Effect.gen(function* () {
 *   const users = yield* CallableClient.make(Users);
 *   // Calls `users-create`.
 *   return yield* users.create({ name: "Ada" });
 * });
 * ```
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const make = <T extends Callable.Any | CallableGroup.Any>(
  target: T,
): Effect.Effect<Client<T>, never, ClientFunctions.ClientFunctions> =>
  Effect.map(Effect.service(ClientFunctions.ClientFunctions), ({ instance }) => {
    if (!CallableGroup.isCallableGroup(target)) {
      const callable = target as Callable.Any;
      return { [callable.name]: method(instance, callable, undefined, callable.name) } as Client<T>;
    }
    const client: Record<string, ReturnType<typeof method>> = {};
    for (const [name, callable] of Object.entries(target.callables)) {
      client[name] = method(instance, callable, target.identifier, `${target.identifier}-${name}`);
    }
    return client as Client<T>;
  });
