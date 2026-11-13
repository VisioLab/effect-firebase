/**
 * A wrapper around the client SDK's `onSnapshot` that lets a test count the
 * listeners attached and detached, and make Firestore refuse or drop them.
 *
 * The client SDK exports `onSnapshot` as a function of its own rather than as
 * a method, so a test file wraps it where it is imported from, before anything
 * imports it:
 *
 * ```ts
 * vi.mock("firebase/firestore", async (importOriginal) =>
 *   (await import("./listeners.ts")).wrapOnSnapshot(await importOriginal()),
 * );
 * ```
 *
 * The emulator runs without security rules, so it never refuses or drops a
 * listener on its own; {@link listeners} stands in for that.
 */
import type * as Firestore from "firebase/firestore";

type OnSnapshot = (...args: ReadonlyArray<unknown>) => () => void;

interface Listener {
  readonly onError: (error: Error) => void;
  readonly unsubscribe: () => void;
}

const live = new Set<Listener>();

/** What the wrapped `onSnapshot` has done since the last {@link reset}. */
export const listeners = {
  /** The listeners attached through the SDK. */
  attached: 0,
  /** The attached listeners that were detached again. */
  detached: 0,
  /** Reported to each new listener instead of attaching it, where set. */
  failWith: undefined as Error | undefined,
  /** The listeners attached and not detached yet. */
  get active(): number {
    return this.attached - this.detached;
  },
  /**
   * Drops every attached listener with `error`, the way the SDK does when
   * Firestore refuses a listen, such as on `permission-denied`: the SDK
   * detaches it and reports `error` to it.
   */
  drop(error: Error): void {
    for (const listener of live) {
      listener.unsubscribe();
      listener.onError(error);
    }
  },
  /** Starts the counts over and stops failing new listeners. */
  reset(): void {
    this.attached = 0;
    this.detached = 0;
    this.failWith = undefined;
    live.clear();
  },
};

/**
 * The client SDK module `actual` with its `onSnapshot` reporting to
 * {@link listeners}.
 */
export const wrapOnSnapshot = (actual: typeof Firestore): typeof Firestore => ({
  ...actual,
  onSnapshot: ((...args: ReadonlyArray<unknown>) => {
    // The error callback is the second one, wherever listen options put it.
    const [, onError] = args.filter((arg) => typeof arg === "function") as unknown as ReadonlyArray<
      (error: Error) => void
    >;
    if (listeners.failWith !== undefined) {
      onError!(listeners.failWith);
      return () => {};
    }
    const unsubscribe = (actual.onSnapshot as OnSnapshot)(...args);
    const listener: Listener = { onError: onError!, unsubscribe };
    live.add(listener);
    listeners.attached++;
    return () => {
      if (live.delete(listener)) {
        listeners.detached++;
      }
      unsubscribe();
    };
  }) as typeof Firestore.onSnapshot,
});
