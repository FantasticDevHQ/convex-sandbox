import { v } from "convex/values";
import { internalAction, type ActionCtx } from "./_generated/server.js";
import { components } from "./_generated/api.js";
import { createBoatProvider } from "@fantastic.dev/convex-sandbox/boat";
import {
  SandboxProviders,
  createExecutionStore,
} from "@fantastic.dev/convex-sandbox";

const sandbox = { scope: "boat-execution-proof", key: "machine" };
const handle = (operationId: string) => ({
  sandbox: { ...sandbox, key: operationId },
  operationId,
});
const json = (body: unknown) => new Response(JSON.stringify(body));
function client(ctx: ActionCtx, fetch: typeof globalThis.fetch) {
  const providers = new SandboxProviders({ authorize: async () => {} });
  providers.register(
    createBoatProvider({ apiKey: "synthetic-execution-proof", fetch }),
  );
  return providers.execution(createExecutionStore(ctx, components.sandbox));
}

// Internal disposable qualification fixture: no live provider or credentials.
export const accept = internalAction({
  args: {},
  returns: v.object({
    stored: v.boolean(),
    unknown: v.boolean(),
    once: v.boolean(),
  }),
  handler: async (ctx) => {
    let starts = 0;
    const execution = client(ctx, async () => {
      starts++;
      if (starts === 2) throw new Error("Synthetic lost start reply");
      return json({
        ok: true,
        success: true,
        type: "command.started",
        commandId: "execution-history-id",
      });
    });
    for (const operationId of ["known", "lost"])
      await ctx.runMutation(components.sandbox.registry.ensure, {
        sandbox: handle(operationId).sandbox,
        reference: {
          provider: "boat",
          providerId: `execution-vm-${operationId}`,
        },
      });
    const known = await execution.start({
      ...handle("known"),
      input: { kind: "shell", command: "printf synthetic" },
    });
    await execution.start({
      ...handle("lost"),
      input: { kind: "shell", command: "printf synthetic" },
    });
    const unknown = await execution.status(handle("lost"));
    return {
      stored:
        known.executionId === "execution-history-id" &&
        known.state === "running",
      unknown: unknown?.state === "unknown",
      once: starts === 2,
    };
  },
});

export const complete = internalAction({
  args: {},
  returns: v.object({
    completed: v.boolean(),
    unknown: v.boolean(),
    readOnly: v.boolean(),
  }),
  handler: async (ctx) => {
    let reads = 0,
      mutations = 0;
    const execution = client(ctx, async (url, init) => {
      if (init?.method !== "GET") {
        mutations++;
        throw new Error("Unexpected mutation");
      }
      reads++;
      if (
        !String(url).endsWith(
          "/sandboxes/execution-vm-known/command-history/execution-history-id",
        )
      )
        throw new Error("Unexpected history identity");
      return json({
        ok: true,
        command: {
          commandId: "execution-history-id",
          sandboxId: "execution-vm-known",
          mode: "detached",
          status: "exited",
          exitCode: 0,
        },
      });
    });
    const known = await execution.status(handle("known"));
    const lost = await execution.status(handle("lost"));
    return {
      completed: known?.state === "completed" && known.exitCode === 0,
      unknown: lost?.state === "unknown" && lost.executionId === undefined,
      readOnly: reads === 1 && mutations === 0,
    };
  },
});
