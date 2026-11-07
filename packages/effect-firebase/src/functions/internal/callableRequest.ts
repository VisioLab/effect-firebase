/** @internal */
import { Context } from "effect";
import type * as Public from "../CallableRequest.ts";

/** @internal */
export const CallableRequest = Context.Service<Public.CallableRequest>(
  "@visiolab/effect-firebase/functions/CallableRequest",
);
