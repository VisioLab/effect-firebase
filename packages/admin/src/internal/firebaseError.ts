/**
 * The `service/string-code` of an error the Admin SDK raised, or `undefined`
 * for anything else.
 *
 * @internal
 */
export const codeOf = (cause: unknown): string | undefined =>
  // firebase-admin 13 declares `FirebaseError` only as an interface, so
  // `instanceof` throws there. Every Firebase error on 13 and 14 carries a
  // string code prefixed with its service, which also tells it apart from
  // Node's own codes such as `ECONNREFUSED`.
  typeof cause === "object" &&
  cause !== null &&
  "code" in cause &&
  typeof cause.code === "string" &&
  cause.code.includes("/")
    ? cause.code
    : undefined;
