import type { GenericActionCtx, GenericDataModel } from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";
import type { FileStore } from "../files.js";

/** The host must add its own authorizePath callback. No file data crosses RPC. */
export function createFileStore(
  ctx: Pick<GenericActionCtx<GenericDataModel>, "runQuery">,
  component: ComponentApi,
): Pick<FileStore, "getSandbox"> {
  return {
    getSandbox: (sandbox) => ctx.runQuery(component.registry.get, { sandbox }),
  };
}
