/**
 * The `service/string-code` of an error the Admin SDK raised, or `undefined`
 * for anything else.
 *
 * firebase-admin 14 exports `FirebaseError` as a class, but 13 only declares it
 * as an interface, so an `instanceof` check throws there. The check is
 * structural instead: every Firebase error carries a string `code` prefixed
 * with its service on both majors, which also tells it apart from Node's own
 * codes such as `ECONNREFUSED`.
 *
 * @internal
 */
export const codeOf = (cause: unknown): string | undefined =>
  typeof cause === "object" &&
  cause !== null &&
  "code" in cause &&
  typeof cause.code === "string" &&
  cause.code.includes("/")
    ? cause.code
    : undefined;
