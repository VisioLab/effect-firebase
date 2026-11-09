/**
 * Reads what the fixture records next to the tests: files of JSON lines that
 * it appends to and never truncates.
 */
import { existsSync, readFileSync } from "node:fs";
import { Data, type Duration, Effect, Schedule } from "effect";

/** No line of the file at `path` matched yet. */
export class NoMatchingLine extends Data.TaggedError("NoMatchingLine")<{
  readonly path: string;
}> {}

/** Every line of the JSON-lines file at `path`, parsed. None when it doesn't exist yet. */
export const readLines = <A>(path: string): ReadonlyArray<A> =>
  existsSync(path)
    ? readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as A)
    : [];

/**
 * Waits for the first line of the file at `path` that `match` accepts, for
 * what the fixture records after the test's own request returns, such as the
 * events its triggers receive. Fails after `timeout`: the first event of a
 * trigger also starts its worker.
 */
export const waitForLine = <A>(
  path: string,
  match: (line: A) => boolean,
  timeout: Duration.Input = "20 seconds",
): Effect.Effect<A, NoMatchingLine> =>
  Effect.suspend(() => {
    const found = readLines<A>(path).find(match);
    return found === undefined ? Effect.fail(new NoMatchingLine({ path })) : Effect.succeed(found);
  }).pipe(
    Effect.retry({ schedule: Schedule.spaced("100 millis") }),
    Effect.timeoutOrElse({
      duration: timeout,
      orElse: () => Effect.fail(new NoMatchingLine({ path })),
    }),
  );
