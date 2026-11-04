import { v } from "convex/values";
import { internalAction, type ActionCtx } from "./_generated/server.js";
import { components } from "./_generated/api.js";
import { createBoatProvider } from "@fantastic.dev/convex-sandbox/boat";
import {
  SandboxProviders,
  createImageStore,
} from "@fantastic.dev/convex-sandbox";

const sandbox = { scope: "boat-image-proof", key: "source" };
const handle = { sandbox, operationId: "fork" };
function client(ctx: ActionCtx, fetch: typeof globalThis.fetch) {
  const providers = new SandboxProviders({ authorize: async () => {} });
  providers.register(
    createBoatProvider({ apiKey: "synthetic-image-proof", fetch }),
  );
  return providers.images(createImageStore(ctx, components.sandbox));
}
const json = (body: unknown) => new Response(JSON.stringify(body));
export const accept = internalAction({
  args: {},
  returns: v.object({
    pending: v.boolean(),
    singleFork: v.boolean(),
    catalogPending: v.boolean(),
    safeInputs: v.boolean(),
    unsupportedRestore: v.boolean(),
  }),
  handler: async (ctx) => {
    let posts = 0,
      safe = false;
    const images = client(ctx, async (url, init) => {
      if (init?.method === "POST") {
        posts++;
        const body = JSON.parse(String(init.body));
        safe =
          body.noEnv === true &&
          Object.keys(body.env).length === 0 &&
          body.ttlSeconds === 3600 &&
          new Headers(init.headers).has("Idempotency-Key");
        return json({
          ok: true,
          id: "image-proof-child",
          sandbox: { id: "image-proof-child", state: "provisioning" },
        });
      }
      if (String(url).endsWith("/saved-snapshots"))
        return json({
          ok: true,
          snapshots: [
            {
              name: "pending-template",
              status: "saving",
              sourceSandboxId: "image-proof-source",
            },
            {
              name: "hidden-template",
              status: "ready",
              sourceSandboxId: "another-source",
              snapshotId: "another-artifact",
            },
          ],
        });
      return json({
        ok: true,
        sandbox: { id: "image-proof-child", state: "provisioning" },
      });
    });
    await ctx.runMutation(components.sandbox.registry.ensure, {
      sandbox,
      reference: { provider: "boat", providerId: "image-proof-source" },
    });
    await images.run({ ...handle, kind: "fork" });
    await images.run({ ...handle, kind: "fork" });
    const pending = await images.status(handle),
      catalog = await images.listTemplates({ sandbox });
    let unsupported = false;
    try {
      await images.run({
        ...handle,
        operationId: "restore",
        kind: "restore",
        image: {
          provider: "boat",
          kind: "disk-snapshot",
          id: "native-artifact",
        },
      });
    } catch {
      unsupported = true;
    }
    return {
      pending:
        pending?.status === "running" &&
        !!pending.nativeImage?.providerOperationId,
      singleFork: posts === 1,
      catalogPending:
        catalog.items.length === 1 &&
        catalog.items[0].reference.id === "pending-template" &&
        catalog.items[0].readiness === "pending",
      safeInputs: safe,
      unsupportedRestore: unsupported && posts === 1,
    };
  },
});
export const complete = internalAction({
  args: {},
  returns: v.object({
    ready: v.boolean(),
    readOnly: v.boolean(),
    sourceUnchanged: v.boolean(),
  }),
  handler: async (ctx) => {
    let reads = 0,
      writes = 0;
    const images = client(ctx, async (url, init) => {
      if (init?.method !== "GET") {
        writes++;
        throw new Error("Unexpected native mutation");
      }
      if (!String(url).endsWith("/sandboxes/image-proof-child"))
        throw new Error("Unexpected child identity");
      reads++;
      return json({
        ok: true,
        sandbox: { id: "image-proof-child", state: "ready" },
      });
    });
    const result = await images.status(handle);
    const source = await ctx.runQuery(components.sandbox.registry.get, {
      sandbox,
    });
    return {
      ready:
        result?.status === "succeeded" &&
        result.nativeImage?.result !== undefined &&
        "machine" in result.nativeImage.result &&
        result.nativeImage.result.machine.providerId === "image-proof-child",
      readOnly: reads === 1 && writes === 0,
      sourceUnchanged: source?.reference.providerId === "image-proof-source",
    };
  },
});
