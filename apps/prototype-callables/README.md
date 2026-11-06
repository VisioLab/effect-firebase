# PROTOTYPE: end-to-end callables through the emulator

Throwaway. Never merged. It answers [End-to-end callable prototype through the emulator](https://github.com/VisioLab/effect-firebase/issues/165) on the map [Wayfinder: Type-safe callable functions](https://github.com/VisioLab/effect-firebase/issues/155).

The contract, server and client below are rough stand-ins, built only to check that the decided shape holds up.

| File | Stands in for |
| --- | --- |
| `src/core.ts` | core `./functions`: `Callable`, `CallableGroup`, `CallableMiddleware`, `CallableError`, `Caller` |
| `src/server.ts` | `@visiolab/effect-firebase-functions/https`: `CallableFunction`, `CallableRequest` |
| `src/client.ts` | `@visiolab/effect-firebase-client/functions`: `ClientFunctions`, `CallableClient` |
| `src/contract.ts` | an app's shared contract |
| `src/functions.ts` | an app's functions entry point |
| `src/call.ts` | an app calling through the typed client |
| `src/types.probe.ts` | type-level checks, run with `npx tsc -p .` |
| `emulator-run.log` | emulator output from the run the findings below are based on |

## Run

```sh
vp run build
npx firebase emulators:start --only functions,auth --project demo-effect-firebase
vpx src/call.ts                # plain httpsCallable
PROTO_STREAM=1 vpx src/call.ts # .stream() with an AbortSignal
```

To check that a disconnect reaches the server, call a worker's socket directly and drop the connection. The socket path is the `PORT` in the `module load` log line.

## Findings

See the resolution comment on the ticket.
