// The tests pass handlers that fail with undeclared errors on purpose, to check
// they are type errors; the language service would flag each of them a second
// time.
// @effect-diagnostics missingEffectError:off
import * as Callable from "@visiolab/effect-firebase/functions/Callable";
import * as CallableError from "@visiolab/effect-firebase/functions/CallableError";
import { Context, Effect, type Layer, Schema } from "effect";
import { describe, expect, test } from "tstyche";

class Clock extends Context.Service<Clock, { readonly now: Effect.Effect<Date> }>()("test/Clock") {}
class Config extends Context.Service<Config, { readonly greeting: string }>()("test/Config") {}

describe("Callable.make", () => {
  test("keeps the name as a literal type", () => {
    expect(Callable.make("greet").name).type.toBe<"greet">();
  });

  test("defaults to no Payload and a void success", () => {
    const Ping = Callable.make("ping");
    expect(Ping.payload).type.toBe<typeof Schema.Void>();
    expect(Ping.success).type.toBe<typeof Schema.Void>();
    expect<Callable.Payload<typeof Ping>>().type.toBe<void>();
    expect<Callable.Success<typeof Ping>>().type.toBe<void>();
  });

  test("takes struct fields as the Payload", () => {
    const Greet = Callable.make("greet", { payload: { name: Schema.String } });
    expect<Callable.Payload<typeof Greet>>().type.toBe<{ readonly name: string }>();
  });

  test("defaults to never failing with an error of its own", () => {
    const Ping = Callable.make("ping");
    expect<Callable.Error<typeof Ping>>().type.toBe<never>();
  });

  test("takes one error schema", () => {
    const Get = Callable.make("get", { error: CallableError.NotFound });
    expect<Callable.Error<typeof Get>>().type.toBe<CallableError.NotFound>();
  });

  test("takes an array of error schemas", () => {
    const Get = Callable.make("get", {
      error: [CallableError.NotFound, CallableError.PermissionDenied],
    });
    expect<Callable.Error<typeof Get>>().type.toBe<
      CallableError.NotFound | CallableError.PermissionDenied
    >();
  });

  test("takes an error schema given a code with Callable.errorCode", () => {
    class Missing extends Schema.TaggedError<Missing, { readonly brand: unique symbol }>()(
      "Missing",
      {},
    ) {}
    const Get = Callable.make("get", { error: Missing.pipe(Callable.errorCode("not-found")) });
    expect<Callable.Error<typeof Get>>().type.toBe<Missing>();
  });

  test("an unknown error code is a type error", () => {
    // @ts-expect-error not assignable
    Callable.errorCode("ok");
  });

  test("takes a schema as the Payload", () => {
    const Greet = Callable.make("greet", { payload: Schema.String, success: Schema.Date });
    expect(Greet.payload).type.toBe<typeof Schema.String>();
    expect(Greet.success).type.toBe<typeof Schema.Date>();
  });
});

describe("Callable.toLayer", () => {
  const Greet = Callable.make("greet", {
    payload: { name: Schema.String, at: Schema.Date },
    success: Schema.String,
  });

  test("provides the handler of the Callable in no group", () => {
    const layer = Callable.toLayer(Greet, ({ name }) => Effect.succeed(name));
    expect(layer).type.toBe<Layer.Layer<Callable.Handler<Callable.NoGroup, "greet">>>();
  });

  test("requires what the handler and its construction need", () => {
    const layer = Callable.toLayer(
      Greet,
      Effect.gen(function* () {
        const { greeting } = yield* Config;
        return ({ name }: Callable.Payload<typeof Greet>) =>
          Effect.map(Effect.service(Clock), () => `${greeting}, ${name}!`);
      }),
    );
    expect(layer).type.toBe<
      Layer.Layer<Callable.Handler<Callable.NoGroup, "greet">, never, Clock | Config>
    >();
  });

  test("a handler reading a wrong Payload type is a type error", () => {
    // @ts-expect-error not assignable
    Callable.toLayer(Greet, ({ at }: { readonly at: string }) => Effect.succeed(at));
  });

  test("a handler may fail with a declared error", () => {
    const Get = Callable.make("get", { error: CallableError.NotFound });
    expect(Callable.toLayer(Get, () => Effect.fail(new CallableError.NotFound()))).type.toBe<
      Layer.Layer<Callable.Handler<Callable.NoGroup, "get">>
    >();
  });

  test("a handler failing with an undeclared error is a type error", () => {
    const Get = Callable.make("get", { error: CallableError.NotFound });
    // @ts-expect-error not assignable
    Callable.toLayer(Get, () => Effect.fail(new CallableError.PermissionDenied()));
  });

  test("a handler of a Callable without errors can't fail", () => {
    // @ts-expect-error not assignable
    Callable.toLayer(Greet, () => Effect.fail(new CallableError.NotFound()));
  });

  test("a handler succeeding with the wrong type is a type error", () => {
    // @ts-expect-error not assignable
    Callable.toLayer(Greet, () => Effect.succeed(1));
  });
});
