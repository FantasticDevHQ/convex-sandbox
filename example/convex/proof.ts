import {
  SandboxBoundary,
  SandboxProviders,
  registerProvider,
  createLifecycleStore,
} from "@fantastic.dev/convex-sandbox";
import type { ComponentApi } from "@fantastic.dev/convex-sandbox/_generated/component.js";
import { internalAction, internalQuery } from "./_generated/server.js";
import { components } from "./_generated/api.js";
import { v } from "convex/values";

const sandbox: ComponentApi = components.sandbox;
const observationFields = {
  scope: v.string(),
  key: v.string(),
  provider: v.string(),
  providerId: v.string(),
  state: v.union(v.literal("running"), v.literal("stopped")),
};

// Server-only synthetic proof. This is not a public, unauthenticated sandbox API.
const boundary = new SandboxBoundary({
  simulated: {
    describe: async (id) => ({
      id,
      state: "running",
      token: "synthetic-not-a-credential",
    }),
  },
});

export const observe = internalAction({
  args: {},
  returns: v.object(observationFields),
  handler: async (ctx) =>
    boundary.observe(
      {
        scope: "internal-fixture",
        key: "proof",
        provider: "simulated",
        providerId: "fixture-1",
      },
      async (observation) => {
        await ctx.runMutation(sandbox.observations.record, observation);
      },
    ),
});

export const latest = internalQuery({
  args: {},
  returns: v.union(v.null(), v.object(observationFields)),
  handler: async (ctx) =>
    ctx.runQuery(sandbox.observations.get, {
      scope: "internal-fixture",
      key: "proof",
    }),
});

/** Internal, synthetic host bridge proof. No live provider or public endpoint. */
export const lifecycle = internalAction({
  args: {},
  returns: v.object({
    created: v.boolean(),
    stopped: v.boolean(),
    deleted: v.boolean(),
  }),
  handler: async (ctx) => {
    let state: "running" | "stopped" | "deleted" = "running";
    let creates = 0;
    const providers = new SandboxProviders({
      authorize: async () => {},
      authorizeCreate: async () => {},
    });
    providers.register(
      registerProvider({
        name: "lifecycle-simulated",
        createIdempotency: "none",
        capabilities: {
          version: 1,
          supported: ["create", "describe", "stop", "delete"],
        },
        adapter: {
          describe: async (providerId) => ({ providerId, state }),
          create: async () => {
            creates++;
            return { providerId: "fixture-machine", state };
          },
          stop: async (providerId) => {
            state = "stopped";
            return { providerId, state };
          },
          delete: async (providerId) => {
            state = "deleted";
            return { providerId, state };
          },
        },
      }),
    );
    const client = providers.lifecycle(createLifecycleStore(ctx, sandbox));
    const identity = { scope: "internal-fixture", key: "lifecycle-proof" };
    await client.create({
      sandbox: identity,
      provider: "lifecycle-simulated",
      operationId: "create",
    });
    await client.create({
      sandbox: identity,
      provider: "lifecycle-simulated",
      operationId: "create",
    });
    await client.run({
      sandbox: identity,
      operationId: "stop",
      action: "stop",
    });
    const stopped = (await client.get(identity))?.observedState === "stopped";
    await client.run({
      sandbox: identity,
      operationId: "delete",
      action: "delete",
    });
    return {
      created: creates === 1,
      stopped,
      deleted: (await client.get(identity))?.tombstone === true,
    };
  },
});
