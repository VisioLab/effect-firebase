import * as Callable from "@visiolab/effect-firebase/functions/Callable";
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

  test("a handler succeeding with the wrong type is a type error", () => {
    // @ts-expect-error not assignable
    Callable.toLayer(Greet, () => Effect.succeed(1));
  });
});
