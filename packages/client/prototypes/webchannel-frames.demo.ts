/**
 * PROTOTYPE, throwaway. Lives only on the `prototype-webchannel-spike` branch.
 *
 * Feeds `WebChannelFrames.decodeString` well-formed, awkward and hostile
 * input, and prints what each case decodes to or fails with.
 *
 *   vpx packages/client/prototypes/webchannel-frames.demo.ts
 */
import { Console, Effect, Exit, Stream } from "effect";
import * as WebChannelFrames from "./WebChannelFrames.ts";

const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text);
const emoji = bytes(`11\n["Grüße😀"]`);

const cases: ReadonlyArray<readonly [string, Stream.Stream<string>]> = [
  ["two frames in one chunk", Stream.make(`3\n[1]3\n[2]`)],
  ["frame split across chunks", Stream.make("1", "4\n[[0,[", '"noop"]]]')],
  [
    "multi-byte character split between byte chunks",
    // Splits inside the 4-byte emoji: decodeText must carry the partial character.
    Stream.make(emoji.slice(0, 14), emoji.slice(14)).pipe(Stream.decodeText()),
  ],
  ["not a number", Stream.make(`abc\n[1]`)],
  ["negative length", Stream.make(`-3\n[1]`)],
  ["no newline, garbage", Stream.make(`[[[[[[[[[[[[[[`)],
  ["no newline, endless digits", Stream.make("9".repeat(64))],
  ["length above maxFrameLength", Stream.make(`999999\n[`)],
  ["invalid JSON", Stream.make(`3\n[1,`)],
  ["input ends inside a frame", Stream.make(`10\n[1,2`)],
  ["valid frame, then truncated", Stream.make(`3\n[1]5\n[2`)],
];

const program = Effect.forEach(cases, ([name, input]) =>
  input.pipe(
    Stream.pipeThroughChannel(WebChannelFrames.decodeString({ maxFrameLength: 1000 })),
    Stream.runCollect,
    Effect.exit,
    Effect.flatMap((exit) =>
      Console.log(
        `${name.padEnd(48)} ${
          Exit.isSuccess(exit)
            ? `ok    ${JSON.stringify(exit.value)}`
            : `fails ${Exit.findErrorOption(exit).pipe((e) => (e._tag === "Some" ? `${e.value._tag}(${e.value.reason})` : "defect"))}`
        }`,
      ),
    ),
  ),
);

await Effect.runPromise(program);
