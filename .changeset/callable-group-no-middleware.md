---
"@visiolab/effect-firebase": minor
"@visiolab/effect-firebase-client": minor
"@visiolab/effect-firebase-functions": minor
---

A Callable Group carries no middleware: `CallableGroup` has no `.middleware`, and Callable Middleware attaches only to a single Callable. Attach a middleware to each member that needs it, such as `Callable.make("me").middleware(Caller.Authenticated)`. `CallableFunction.group` no longer requires a group middleware's implementation, and a member's client function fails with its own middleware's errors only.
