import { v } from "convex/values";
import { internalAction } from "./_generated/server.js";
import { components } from "./_generated/api.js";
import { createBoatProvider } from "@fantastic.dev/convex-sandbox/boat";
import {
  SandboxProviders,
  createLifecycleStore,
} from "@fantastic.dev/convex-sandbox";

const sandbox = { scope: "boat-reconcile-proof", key: "machine" };
const budget = { ...sandbox, key: "budget" };
const json = (id: string, state: string) =>
  new Response(JSON.stringify({ ok: true, sandbox: { id, state } }));
export const accept = internalAction({
  args: {},
  returns: v.object({
    reversedReply: v.boolean(),
    bounded: v.boolean(),
    singleMutation: v.boolean(),
  }),
  handler: async (ctx) => {
    let resolveOld: (value: Response) => void = () => {},
      sent: () => void = () => {};
    const old = new Promise<Response>((resolve) => {
      resolveOld = resolve;
    });
    const started = new Promise<void>((resolve) => {
      sent = resolve;
    });
    let mainReads = 0,
      budgetReads = 0,
      mutations = 0;
    const providers = new SandboxProviders({ authorize: async () => {} });
    providers.register(
      createBoatProvider({
        apiKey: "synthetic-reconcile-proof",
        fetch: async (url, init) => {
          if (init?.method === "POST") {
            mutations++;
            return new Response(
              JSON.stringify({
                ok: true,
                id: "budget-vm",
                sandbox: { id: "budget-vm", state: "provisioning" },
              }),
            );
          }
          if (String(url).endsWith("/sandboxes/budget-vm")) {
            budgetReads++;
            return json("budget-vm", "provisioning");
          }
          if (
            init?.method !== "GET" ||
            !String(url).endsWith("/sandboxes/reconcile-vm")
          )
            throw new Error("Unexpected native observation");
          if (++mainReads === 1) {
            sent();
            return old;
          }
          return json("reconcile-vm", "ready");
        },
      }),
    );
    const store = createLifecycleStore(ctx, components.sandbox),
      lifecycle = providers.lifecycle(store);
    for (const [key, providerId] of [
      [sandbox, "reconcile-vm"],
      [budget, "budget-vm"],
    ] as const)
      await ctx.runMutation(components.sandbox.registry.ensure, {
        sandbox: key,
        reference: { provider: "boat", providerId },
      });
    const stale = lifecycle.refresh(sandbox);
    await started;
    await lifecycle.refresh(sandbox);
    resolveOld(json("reconcile-vm", "archived"));
    await stale;
    await lifecycle.run({
      sandbox: budget,
      action: "start",
      operationId: "resume",
    });
    const result = await lifecycle.reconcile({
      sandbox: budget,
      operationId: "resume",
      policy: { maxAttempts: 1 },
    });
    const record = await ctx.runQuery(components.sandbox.registry.get, {
      sandbox,
    });
    return {
      reversedReply:
        record?.observedState === "running" &&
        record.observedSequence === 2 &&
        record.refresh.status === "fresh",
      bounded: result?.status === "unknown" && budgetReads === 1,
      singleMutation: mutations === 1,
    };
  },
});
export const externalStop = internalAction({
  args: {},
  returns: v.object({ stopped: v.boolean(), readOnly: v.boolean() }),
  handler: async (ctx) => {
    let reads = 0,
      mutations = 0;
    const providers = new SandboxProviders({ authorize: async () => {} });
    providers.register(
      createBoatProvider({
        apiKey: "synthetic-external-stop",
        fetch: async (_url, init) => {
          if (init?.method !== "GET") {
            mutations++;
            throw new Error("Unexpected mutation");
          }
          reads++;
          return json("reconcile-vm", "archived");
        },
      }),
    );
    const result = await providers
      .lifecycle(createLifecycleStore(ctx, components.sandbox))
      .refresh(sandbox);
    return {
      stopped: result?.observedState === "stopped",
      readOnly: reads === 1 && mutations === 0,
    };
  },
});
