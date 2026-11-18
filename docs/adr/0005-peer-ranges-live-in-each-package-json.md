# Peer ranges live in each package's package.json

The published packages take `effect` and the Firebase SDKs as peer dependencies. Their ranges are written out in each package's `peerDependencies`, not drawn from a pnpm catalog, while the versions the repo develops and tests against stay in the default catalog. Dependabot reads every catalog entry, named catalogs included, as an ordinary dependency and raises it on each release, which would narrow what consumers may install a little further with every bump. It does not parse `peerDependencies` at all, so a range written there stays where it was put.

Each Firebase range starts at the oldest release the emulator tests pass on, and the `floor` entry of CI's `test` matrix installs exactly those releases and runs the suite again. A floor sits above a major's `.0` only when that release fails:

- `firebase-admin` `^13.5.0 || ^14`: before 13.5, `initializeApp` throws for an app name already taken, and `App` calls it again to adopt an app the host initialized.
- `firebase` `^12.18.0 || ^13`: the Client tells an answer from a failed request by the HTTP status the SDK appends to a Callable error's message, which `@firebase/functions` 0.14, first bundled in firebase 12.18, is the first to add.
- `firebase-functions` `^7`.

`effect` is `~4.1.0`, patches only, for the reason in ADR 0002.

## Considered Options

- **A `peers` catalog.** Rejected: Dependabot raised its entries along with the dev versions.
- **Keep the catalog and fail CI when a range no longer starts at the tested floor.** Rejected: it catches the bump after Dependabot opens it, and someone still has to undo it by hand in every such pull request.
- **Switch to Renovate**, which widens `peerDependencies` rather than raising them. Rejected for now: writing the ranges out is enough, and it keeps the existing Dependabot groups.

## Consequences

- A range used by several packages, such as `effect` or `firebase-admin`, is written once per package, and changing it means editing each.
- Raising or lowering a floor means changing the range and the matching version in the `floor` entry of `.github/workflows/ci.yml` together.
