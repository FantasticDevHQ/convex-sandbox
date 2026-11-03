import type { GenericDataModel } from "convex/server";
import type { TestConvexRoot } from "convex-test";
import type { ComponentApi } from "../component/_generated/component.js";
import type { FilePathPolicy, FileStore } from "../files.js";
import type { LifecycleStore } from "../lifecycle.js";
import type { ExecutionStore } from "../execution.js";
import type { ImageStore } from "../images.js";

export interface ConformanceStores {
  lifecycle: LifecycleStore;
  execution: ExecutionStore;
  files: FileStore;
  images: ImageStore;
}
/** Optional convex-test bridge. Test dependencies are type-only imports. */
export function createTestStores<DataModel extends GenericDataModel>(
  host: Pick<TestConvexRoot<DataModel>, "query" | "mutation">,
  component: ComponentApi,
  authorizePath: FilePathPolicy,
): ConformanceStores {
  const getSandbox = (sandbox: Parameters<LifecycleStore["get"]>[0]) =>
    host.query(component.registry.get, { sandbox });
  return {
    lifecycle: {
      get: getSandbox,
      getOperation: (sandbox, operationId) =>
        host.query(component.operations.get, { sandbox, operationId }),
      begin: (args) => host.mutation(component.operations.begin, args),
      reserveCreate: (args) =>
        host.mutation(component.lifecycle.reserveCreate, args),
      getProvision: (sandbox) =>
        host.query(component.lifecycle.getProvision, { sandbox }),
      claimCreateReconciliation: (args) =>
        host.mutation(component.lifecycle.claimCreateReconciliation, args),
      finishCreate: (args) =>
        host.mutation(component.lifecycle.finishCreate, args),
      claimOperation: (args) =>
        host.mutation(component.lifecycle.claimOperation, args),
      finishOperation: (args) =>
        host.mutation(component.lifecycle.finishOperation, args),
      beginRefresh: (sandbox) =>
        host.mutation(component.registry.beginRefresh, { sandbox }),
      finishRefresh: (args) =>
        host.mutation(component.registry.finishRefresh, args),
    },
    execution: {
      getSandbox,
      get: (args) => host.query(component.execution.get, args),
      reserve: (args) => host.mutation(component.execution.reserve, args),
      claim: (args) => host.mutation(component.execution.claim, args),
      publish: (args) => host.mutation(component.execution.publish, args),
      requestCancel: (args) =>
        host.mutation(component.execution.requestCancel, args),
      acknowledgeCancel: (args) =>
        host.mutation(component.execution.acknowledgeCancel, args),
      claimLogs: (args) => host.mutation(component.execution.claimLogs, args),
      appendLogs: (args) => host.mutation(component.execution.appendLogs, args),
      logs: (args) => host.query(component.execution.logs, args),
    },
    files: { getSandbox, authorizePath },
    images: {
      getSandbox,
      getOperation: (args) => host.query(component.operations.get, args),
      reserve: (args) => host.mutation(component.images.reserve, args),
      claim: (args) => host.mutation(component.images.claim, args),
      publish: (args) => host.mutation(component.images.publish, args),
    },
  };
}
