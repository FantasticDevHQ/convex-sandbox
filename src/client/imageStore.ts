import type { GenericActionCtx, GenericDataModel } from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";
import type { ImageStore } from "../images.js";

/** Action-local callbacks; SDKs and connection credentials never cross component RPC. */
export function createImageStore(
  ctx: Pick<GenericActionCtx<GenericDataModel>, "runQuery" | "runMutation">,
  component: ComponentApi,
): ImageStore {
  return {
    getSandbox: (sandbox) => ctx.runQuery(component.registry.get, { sandbox }),
    getOperation: (handle) => ctx.runQuery(component.operations.get, handle),
    reserve: (args) => ctx.runMutation(component.images.reserve, args),
    claim: (args) => ctx.runMutation(component.images.claim, args),
    publish: (args) => ctx.runMutation(component.images.publish, args),
  };
}
