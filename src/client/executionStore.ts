import type { GenericActionCtx, GenericDataModel } from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";
import type { ExecutionStore } from "../execution.js";

/** Action-local bridge. Command input and SDK objects never cross these callbacks. */
export function createExecutionStore(
  ctx: Pick<GenericActionCtx<GenericDataModel>, "runQuery" | "runMutation">,
  component: ComponentApi,
): ExecutionStore {
  return {
    getSandbox: (sandbox) => ctx.runQuery(component.registry.get, { sandbox }),
    get: (handle) => ctx.runQuery(component.execution.get, handle),
    reserve: (args) => ctx.runMutation(component.execution.reserve, args),
    claim: (args) => ctx.runMutation(component.execution.claim, args),
    publish: (args) => ctx.runMutation(component.execution.publish, args),
    requestCancel: (args) =>
      ctx.runMutation(component.execution.requestCancel, args),
    acknowledgeCancel: (args) =>
      ctx.runMutation(component.execution.acknowledgeCancel, args),
    claimLogs: (args) => ctx.runMutation(component.execution.claimLogs, args),
    appendLogs: (args) => ctx.runMutation(component.execution.appendLogs, args),
    logs: (args) => ctx.runQuery(component.execution.logs, args),
  };
}
