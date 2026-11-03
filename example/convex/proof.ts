import {
  SandboxBoundary,
  SandboxProviders,
  registerProvider,
  createLifecycleStore,
  createExecutionStore,
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

/** Synthetic command SDK proof. No shell command runs on the host or a live provider. */
export const execution = internalAction({
  args: {},
  returns: v.object({
    startedOnce: v.boolean(),
    completed: v.boolean(),
    cancelAcknowledged: v.boolean(),
    outputBounded: v.boolean(),
    deleted: v.boolean(),
  }),
  handler: async (ctx) => {
    let starts = 0;
    const providers = new SandboxProviders({
      authorize: async () => {},
      authorizeCreate: async () => {},
    });
    providers.register(
      registerProvider({
        name: "execution-simulated",
        createIdempotency: "none",
        capabilities: {
          version: 1,
          supported: [
            "create",
            "describe",
            "delete",
            "execute",
            "cancelExecution",
            "executionLogs",
          ],
        },
        adapter: {
          describe: async (providerId) => ({ providerId, state: "running" }),
          create: async () => ({
            providerId: "fixture-execution-machine",
            state: "running",
          }),
          delete: async (providerId) => ({ providerId, state: "deleted" }),
          execution: {
            idempotency: "none",
            start: async () => {
              starts++;
              return { executionId: "fixture-command", state: "queued" };
            },
            status: async () => ({
              executionId: "fixture-command",
              state: "completed",
              exitCode: 0,
            }),
            cancel: async () => ({ acknowledged: true }),
            logs: async () => ({
              entries: [{ stream: "stdout", text: "synthetic output" }],
              nextCursor: null,
              complete: true,
            }),
          },
        },
      }),
    );
    const identity = { scope: "internal-fixture", key: "execution-proof" };
    const lifecycle = providers.lifecycle(createLifecycleStore(ctx, sandbox));
    await lifecycle.create({
      sandbox: identity,
      provider: "execution-simulated",
      operationId: "create",
    });
    const client = providers.execution(createExecutionStore(ctx, sandbox));
    const handle = { sandbox: identity, operationId: "command" };
    const input = {
      kind: "argv" as const,
      executable: "printf",
      args: ["synthetic output"],
    };
    await client.start({ ...handle, input });
    await client.start({ ...handle, input });
    await client.syncLogs(handle);
    const cancellation = await client.cancel(handle);
    const completed = await client.status(handle);
    const logs = await client.logs({ ...handle, cursor: null });
    await lifecycle.run({
      sandbox: identity,
      operationId: "delete",
      action: "delete",
    });
    return {
      startedOnce: starts === 1,
      completed: completed?.state === "completed" && completed.exitCode === 0,
      cancelAcknowledged:
        cancellation?.cancellation.acknowledgement === "accepted" &&
        cancellation.state === "queued",
      outputBounded:
        logs.entries.map((entry) => entry.text).join("") ===
          "synthetic output" && (completed?.outputBytes ?? Infinity) <= 65536,
      deleted: (await lifecycle.get(identity))?.tombstone === true,
    };
  },
});
