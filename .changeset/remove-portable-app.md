---
"@visiolab/effect-firebase": minor
---

Remove the portable `App` service and its interface: nothing provided it and
nothing asked for it. `defaultAppName` stays exported from
`@visiolab/effect-firebase/App`. The SDK packages keep their own `App`.
