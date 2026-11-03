/** Compiled by typecheck, deliberately not executed. Uses public exports only. */
import { v } from "convex/values";
import {
  registerProvider,
  SandboxProviders,
  type sandboxDescriptionValidator,
  type SandboxDescription,
  type SandboxKey,
  type ProviderReference,
  type OperationHandle,
  type ExecutionHandle,
  type MachineResources,
} from "@fantastic.dev/convex-sandbox";
import type { Infer } from "convex/values";

const sandbox: SandboxKey = { scope: "arbitrary", key: "logical" };
const reference: ProviderReference = {
  provider: "new-provider",
  providerId: "replaceable",
};
const resources: MachineResources = { cpuCount: 0.5, memoryMiB: 512 };
const provider = registerProvider({
  name: "new-provider",
  adapter: {
    describe: async (providerId) => ({
      providerId,
      state: "running",
      resources,
    }),
  },
  extensions: {
    "new-provider.snapshot": {
      args: v.object({ label: v.string() }),
      returns: v.object({ id: v.string() }),
    },
  },
});
const providers = new SandboxProviders({ authorize: async () => {} });
providers.register(provider);
const result: Promise<SandboxDescription> = providers.describe({
  sandbox,
  reference,
});
const operation: OperationHandle = { sandbox, operationId: "operation" };
const execution: ExecutionHandle = {
  ...operation,
  reference,
  executionId: "execution",
};
const inferred: Infer<typeof sandboxDescriptionValidator> = {
  sandbox,
  reference,
  state: "unknown",
};
void result;
void execution;
void inferred;
// @ts-expect-error A logical key does not require or contain a provider ID.
const misplaced: SandboxKey = reference;
// @ts-expect-error No extension executor exists until capability-gated dispatch is implemented.
providers.extension("new-provider.snapshot", { label: "unsafe" });
// @ts-expect-error Every host must supply an authorization boundary.
new SandboxProviders({});
void misplaced;

type SnapshotArgs = Infer<
  NonNullable<typeof provider.extensions>["new-provider.snapshot"]["args"]
>;
const snapshotArgs: SnapshotArgs = { label: "typed" };
// @ts-expect-error The extension's argument validator retains its specific type.
const badSnapshotArgs: SnapshotArgs = { label: 123 };
void snapshotArgs;
void badSnapshotArgs;
