import { v } from "convex/values";
import { internalAction, type ActionCtx } from "./_generated/server.js";
import { components } from "./_generated/api.js";
import { createBoatProvider } from "@fantastic.dev/convex-sandbox/boat";
import {
  SandboxProviders,
  createLifecycleStore,
} from "@fantastic.dev/convex-sandbox";

const sandbox = { scope: "boat-lifecycle-proof", key: "machine" };
const id = "lifecycle-vm";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
function client(ctx: ActionCtx, fetch: typeof globalThis.fetch) {
  const providers = new SandboxProviders({ authorize: async () => {} });
  providers.register(
    createBoatProvider({ apiKey: "synthetic-lifecycle-proof", fetch }),
  );
  const store = createLifecycleStore(ctx, components.sandbox);
  return { lifecycle: providers.lifecycle(store), store };
}

// Internal synthetic native API. Never calls Boat or uses a real account key.
export const accept = internalAction({
  args: {},
  returns: v.object({
    stopped: v.boolean(),
    resumed: v.boolean(),
    pending: v.boolean(),
    confirmation: v.boolean(),
    noForcedStop: v.boolean(),
  }),
  handler: async (ctx) => {
    let machine = "ready";
    let removed = false;
    let confirmation = false;
    let noForcedStop = false;
    const f = client(ctx, async (url, init = {}) => {
      const path = new URL(String(url)).pathname;
      if (init.method === "DELETE") {
        confirmation =
          new Headers(init.headers).get("X-Ascii-Confirm-Delete") === id;
        removed = true;
        return json(
          {
            ok: true,
            operation: {
              id: "lifecycle-delete-job",
              targetId: id,
              kind: "sandbox",
              status: "pending",
            },
          },
          202,
        );
      }
      if (path.endsWith("/stop")) {
        noForcedStop = JSON.parse(String(init.body)).force === false;
        machine = "archiving";
        return json(
          {
            ok: true,
            id,
            stop: { id: "lifecycle-stop-job", status: "pending" },
            sandbox: { id, state: machine },
          },
          202,
        );
      }
      if (path.includes("/stops/")) {
        machine = "archived";
        return json({
          ok: true,
          id,
          stop: { id: "lifecycle-stop-job", status: "completed" },
        });
      }
      if (path.endsWith("/resume")) {
        machine = "provisioning";
        return json({ ok: true, id, sandbox: { id, state: machine } }, 202);
      }
      if (path.includes("/deletion-operations/"))
        return json({
          ok: true,
          operation: {
            id: "lifecycle-delete-job",
            targetId: id,
            kind: "sandbox",
            status: "pending",
          },
        });
      if (removed) return json({ error: "not found" }, 404);
      if (machine === "provisioning") machine = "ready";
      return json({ ok: true, sandbox: { id, state: machine } });
    });
    await ctx.runMutation(components.sandbox.registry.ensure, {
      sandbox,
      reference: { provider: "boat", providerId: id },
    });
    await f.lifecycle.run({ sandbox, operationId: "stop", action: "stop" });
    const stopped = await f.lifecycle.reconcile({
      sandbox,
      operationId: "stop",
      policy: { maxAttempts: 1 },
    });
    await f.lifecycle.run({ sandbox, operationId: "start", action: "start" });
    const resumed = await f.lifecycle.reconcile({
      sandbox,
      operationId: "start",
      policy: { maxAttempts: 1 },
    });
    await f.lifecycle.run({ sandbox, operationId: "delete", action: "delete" });
    await f.lifecycle.refresh(sandbox);
    const pending = await f.lifecycle.reconcile({
      sandbox,
      operationId: "delete",
      policy: { maxAttempts: 1 },
    });
    return {
      stopped: stopped?.status === "succeeded",
      resumed: resumed?.status === "succeeded",
      pending:
        pending?.status === "unknown" &&
        pending.nativeLifecycle?.id === "lifecycle-delete-job" &&
        (await f.store.get(sandbox))?.tombstone === false,
      confirmation,
      noForcedStop,
    };
  },
});

export const complete = internalAction({
  args: {},
  returns: v.object({
    completed: v.boolean(),
    tombstone: v.boolean(),
    notRedispatched: v.boolean(),
  }),
  handler: async (ctx) => {
    let mutations = 0;
    const f = client(ctx, async (url, init) => {
      if (init?.method !== "GET") {
        mutations++;
        throw new Error("Unexpected native mutation");
      }
      if (!String(url).endsWith("/deletion-operations/lifecycle-delete-job"))
        return json({}, 404);
      return json({
        ok: true,
        operation: {
          id: "lifecycle-delete-job",
          targetId: id,
          kind: "sandbox",
          status: "completed",
        },
      });
    });
    const result = await f.lifecycle.reconcile({
      sandbox,
      operationId: "delete",
      policy: { maxAttempts: 1 },
    });
    return {
      completed: result?.status === "succeeded",
      tombstone: (await f.store.get(sandbox))?.tombstone === true,
      notRedispatched: mutations === 0,
    };
  },
});
