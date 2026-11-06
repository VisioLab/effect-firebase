import * as Callable from "@visiolab/effect-firebase/functions/Callable";
import { Schema } from "effect";
import { describe, expect, test } from "tstyche";

describe("Callable.make", () => {
  test("keeps the name as a literal type", () => {
    expect(Callable.make("greet").name).type.toBe<"greet">();
  });

  test("defaults to no Payload and a void success", () => {
    const Ping = Callable.make("ping");
    expect(Ping.payload).type.toBe<typeof Schema.Void>();
    expect(Ping.success).type.toBe<typeof Schema.Void>();
  });

  test("takes struct fields as the Payload", () => {
    const Greet = Callable.make("greet", { payload: { name: Schema.String } });
    expect<Schema.Schema.Type<typeof Greet.payload>>().type.toBe<{ readonly name: string }>();
  });

  test("takes a schema as the Payload", () => {
    const Greet = Callable.make("greet", { payload: Schema.String, success: Schema.Date });
    expect(Greet.payload).type.toBe<typeof Schema.String>();
    expect(Greet.success).type.toBe<typeof Schema.Date>();
  });
});
