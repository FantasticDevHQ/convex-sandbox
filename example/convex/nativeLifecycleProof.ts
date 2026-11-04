import { v } from "convex/values";
import { internalAction, type ActionCtx } from "./_generated/server.js";
import { components } from "./_generated/api.js";
import {
  SandboxProviders,
  createLifecycleStore,
} from "@fantastic.dev/convex-sandbox";

const sandbox = { scope: "native-lifecycle-proof", key: "machine" };
const reference = {
  provider: "async-native-fixture",
  providerId: "fixture-vm",
};
const operationId = "delete";

// Internal synthetic qualification only. No provider service or credential.
function fixture(ctx: ActionCtx, completed: boolean) {
  const store = createLifecycleStore(ctx, components.sandbox);
  let mutations = 0;
  let jobRead = false;
  const providers = new SandboxProviders({ authorize: async () => {} });
  providers.register({
    name: reference.provider,
    capabilities: { version: 1, supported: ["describe", "delete"] },
    adapter: {
      delete: async () => {
        mutations++;
        return {
          providerId: reference.providerId,
          state: "stopping",
          lifecycleJob: { id: "fixture-native-job" },
        };
      },
      describe: async (id, context) => {
        jobRead =
          id === reference.providerId &&
          context?.lifecycleJob?.id === "fixture-native-job" &&
          context.lifecycleJob.kind === "delete";
        if (!jobRead) throw new Error("Missing scoped native lifecycle job");
        return {
          providerId: id,
          state: completed ? "deleted" : "stopping",
          lifecycleJob: { id: "fixture-native-job" },
        };
      },
    },
  });
  return {
    store,
    lifecycle: providers.lifecycle(store),
    mutations: () => mutations,
    jobRead: () => jobRead,
  };
}

export const accept = internalAction({
  args: {},
  returns: v.object({
    stored: v.boolean(),
    pending: v.boolean(),
    singleDispatch: v.boolean(),
    jobRead: v.boolean(),
  }),
  handler: async (ctx) => {
    await ctx.runMutation(components.sandbox.registry.ensure, {
      sandbox,
      reference,
    });
    const f = fixture(ctx, false);
    await f.lifecycle.run({ sandbox, operationId, action: "delete" });
    const op = await f.lifecycle.reconcile({
      sandbox,
      operationId,
      policy: { maxAttempts: 1 },
    });
    const row = await f.store.get(sandbox);
    return {
      stored: op?.nativeLifecycle?.id === "fixture-native-job",
      pending: op?.status === "unknown" && row?.tombstone === false,
      singleDispatch: f.mutations() === 1,
      jobRead: f.jobRead(),
    };
  },
});

export const complete = internalAction({
  args: {},
  returns: v.object({
    completed: v.boolean(),
    tombstone: v.boolean(),
    jobRead: v.boolean(),
    notRedispatched: v.boolean(),
  }),
  handler: async (ctx) => {
    // A new action constructs a new adapter, using only the persisted handle.
    const f = fixture(ctx, true);
    const op = await f.lifecycle.reconcile({
      sandbox,
      operationId,
      policy: { maxAttempts: 1 },
    });
    const row = await f.store.get(sandbox);
    return {
      completed:
        op?.status === "succeeded" &&
        op.nativeLifecycle?.id === "fixture-native-job",
      tombstone: row?.tombstone === true,
      jobRead: f.jobRead(),
      notRedispatched: f.mutations() === 0,
    };
  },
});
