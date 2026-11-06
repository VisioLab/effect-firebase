// PROTOTYPE, throwaway. Rough stand-in for @visiolab/effect-firebase-client/functions
// (ClientFunctions, CallableClient).
import { Context, Effect, Layer, Schema } from "effect";
import type { FirebaseApp } from "firebase/app";
import {
  connectFunctionsEmulator,
  FunctionsError,
  getFunctions,
  httpsCallable,
  type Functions,
} from "firebase/functions";
import {
  allErrors,
  CallableError,
  DecodeError,
  EncodeError,
  getErrorCode,
  ResponseError,
  TransportError,
  type AnyCallable,
  type Callable,
  type CallableGroup,
  type ErrorOf,
  type PayloadOf,
  type SuccessOf,
} from "./core.ts";

export class ClientFunctions extends Context.Service<ClientFunctions, Functions>()(
  "effect-firebase-client/ClientFunctions",
) {
  static layer = (
    app: FirebaseApp,
    options: { regionOrCustomDomain?: string; emulator?: { host: string; port: number } } = {},
  ) =>
    Layer.sync(ClientFunctions, () => {
      const functions = getFunctions(app, options.regionOrCustomDomain);
      if (options.emulator) connectFunctionsEmulator(functions, options.emulator.host, options.emulator.port);
      return functions;
    });
}

type Method<C> = (payload: PayloadOf<C>) => Effect.Effect<SuccessOf<C>, ErrorOf<C> | CallableError>;
export type Client<C extends AnyCallable> = { readonly [K in C["name"] & string]: Method<Extract<C, { name: K }>> };

const useStream = process.env.PROTO_STREAM === "1";

const method = (functions: Functions, callable: AnyCallable, deployedName: string) => {
  const fn = httpsCallable(functions, deployedName);
  const fail = (reason: CallableError["reason"]) =>
    Effect.fail(new CallableError({ callable: deployedName, reason }));
  return (payload: unknown) =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeUnknownEffect(Schema.toCodecJson(callable.payload))(payload).pipe(
        Effect.catch((cause) => fail(new EncodeError({ cause }))),
      );
      const result = yield* Effect.tryPromise({
        // Plain httpsCallable takes no AbortSignal; only .stream() does.
        try: (signal) =>
          useStream ? fn.stream(encoded, { signal }).then((r) => r.data.then((data) => ({ data }))) : fn(encoded),
        catch: (e) => e,
      }).pipe(
        Effect.catch((e) => {
          if (!(e instanceof FunctionsError)) return fail(new TransportError({ cause: e }));
          const code = e.code.replace(/^functions\//, "");
          const candidates = allErrors(callable).filter((s) => getErrorCode(s) === code);
          const response = new ResponseError({
            code,
            message: e.message.replace(/ \[\d+\]$/, ""),
            details: e.details,
          });
          if (candidates.length === 0 || e.details === undefined) return fail(response);
          return Schema.decodeUnknownEffect(Schema.toCodecJson(Schema.Union(candidates)))(e.details).pipe(
            Effect.matchEffect({
              onFailure: (cause) => fail(new DecodeError({ cause })),
              onSuccess: (error) => Effect.fail(error),
            }),
          );
        }),
      );
      return yield* Schema.decodeUnknownEffect(Schema.toCodecJson(callable.success))(result.data).pipe(
        Effect.catch((cause) => fail(new DecodeError({ cause }))),
      );
    });
};

export function make<Name extends string, Members extends AnyCallable>(
  group: CallableGroup<Name, Members>,
): Effect.Effect<Client<Members>, never, ClientFunctions>;
export function make<C extends Callable<any, any, any, any, any>>(
  callable: C,
): Effect.Effect<Client<C>, never, ClientFunctions>;
export function make(target: any): Effect.Effect<any, never, ClientFunctions> {
  return Effect.gen(function* () {
    const functions = yield* ClientFunctions;
    const members: ReadonlyArray<AnyCallable> = "callables" in target ? target.callables : [target];
    const client: Record<string, unknown> = {};
    for (const c of members) {
      client[c.name] = method(functions, c, "callables" in target ? `${target.name}-${c.name}` : c.name);
    }
    return client;
  });
}
