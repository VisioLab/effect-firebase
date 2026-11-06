// The tests pass Layers with requirements left on purpose, to check they are
// type errors; the language service would flag each of them a second time.
// @effect-diagnostics missing-layer-context:off
import * as Callable from "@visiolab/effect-firebase/functions/Callable";
import * as CallableFunction from "@visiolab/effect-firebase-functions/https/CallableFunction";
import { Context, Effect, Layer, Schema } from "effect";
import { describe, expect, test } from "tstyche";

const Greet = Callable.make("greet", {
  payload: { name: Schema.String },
  success: Schema.String,
});
const Ping = Callable.make("ping");

const GreetLive = Callable.toLayer(Greet, ({ name }) => Effect.succeed(`Hello, ${name}!`));
const PingLive = Callable.toLayer(Ping, () => Effect.void);

class Clock extends Context.Service<Clock, { readonly now: Effect.Effect<Date> }>()("test/Clock") {}

describe("CallableFunction.make", () => {
  test("exports one Callable Function under the Callable's name", () => {
    const exports = CallableFunction.make(Greet, GreetLive);
    expect(exports).type.toBe<{ readonly greet: CallableFunction.Export }>();
  });

  test("a typo in the destructured export is a type error", () => {
    // @ts-expect-error Property 'gret' does not exist
    const { gret } = CallableFunction.make(Greet, GreetLive);
    void gret;
  });

  test("a Live without the Callable's handler is a type error", () => {
    // @ts-expect-error not assignable
    CallableFunction.make(Greet, PingLive);
  });

  test("a Live that leaves a requirement is a type error", () => {
    const NeedsClock = Callable.toLayer(Greet, ({ name }) =>
      Effect.map(Effect.service(Clock), () => name),
    );
    // @ts-expect-error not assignable
    CallableFunction.make(Greet, NeedsClock);
  });

  test("a Live that provides more is accepted", () => {
    expect(CallableFunction.make(Greet, Layer.merge(GreetLive, PingLive))).type.toBe<{
      readonly greet: CallableFunction.Export;
    }>();
  });
});
