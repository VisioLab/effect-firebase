// The `effect` the package resolves, re-exported for scripts outside the
// package, which cannot resolve `effect` themselves (pnpm installs it under
// `packages/effect-firebase` only). It is the same file, so the same module
// instance the package's own source loads.
export {
  BigDecimal,
  DateTime,
  Duration,
  Option,
  Schema,
  SchemaAST,
} from "../../../packages/effect-firebase/node_modules/effect/dist/index.js";
