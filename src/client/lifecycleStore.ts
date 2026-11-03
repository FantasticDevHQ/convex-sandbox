import type { GenericActionCtx, GenericDataModel } from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";
import type { LifecycleStore } from "../lifecycle.js";

/** Action-local callbacks; only their serializable arguments cross component RPC. */
export function createLifecycleStore(
  ctx: Pick<GenericActionCtx<GenericDataModel>, "runQuery" | "runMutation">,
  component: ComponentApi,
): LifecycleStore {
  return {
    get: (sandbox) => ctx.runQuery(component.registry.get, { sandbox }),
    getOperation: (sandbox, operationId) =>
      ctx.runQuery(component.operations.get, { sandbox, operationId }),
    begin: (args) => ctx.runMutation(component.operations.begin, args),
    reserveCreate: (args) =>
      ctx.runMutation(component.lifecycle.reserveCreate, args),
    getProvision: (sandbox) =>
      ctx.runQuery(component.lifecycle.getProvision, { sandbox }),
    claimCreateReconciliation: (args) =>
      ctx.runMutation(component.lifecycle.claimCreateReconciliation, args),
    finishCreate: (args) =>
      ctx.runMutation(component.lifecycle.finishCreate, args),
    claimOperation: (args) =>
      ctx.runMutation(component.lifecycle.claimOperation, args),
    finishOperation: (args) =>
      ctx.runMutation(component.lifecycle.finishOperation, args),
    beginRefresh: (sandbox) =>
      ctx.runMutation(component.registry.beginRefresh, { sandbox }),
    finishRefresh: (args) =>
      ctx.runMutation(component.registry.finishRefresh, args),
  };
}
