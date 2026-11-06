/** @internal */
import { Context } from "effect";
import type * as Public from "../CallableRequest.ts";

/** @internal */
export const TypeId = "~@visiolab/effect-firebase/functions/CallableRequest";

/** @internal */
export const CallableRequest = Context.Service<Public.CallableRequest>(
  "@visiolab/effect-firebase/functions/CallableRequest",
);

/** @internal */
export const make = <A extends Public.Base>(fields: A): A & Public.CallableRequest =>
  ({ ...fields, [TypeId]: TypeId }) as A & Public.CallableRequest;
