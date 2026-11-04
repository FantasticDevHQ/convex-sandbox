import { v } from "convex/values";
import { internalAction } from "./_generated/server.js";
import { components } from "./_generated/api.js";
import { createBoatProvider } from "@fantastic.dev/convex-sandbox/boat";
import {
  SandboxProviders,
  SandboxProviderError,
  createImageStore,
  createLifecycleStore,
} from "@fantastic.dev/convex-sandbox";

const sandbox = { scope: "boat-connection-proof", key: "machine" };
// Synthetic observations only; never fetches a desktop, hosts a port or adds a key.
export const runtime = internalAction({
  args: {},
  returns: v.object({
    unsupportedKinds: v.boolean(),
    noAccessDispatch: v.boolean(),
    observationSafe: v.boolean(),
    recordsSafe: v.boolean(),
  }),
  handler: async (ctx) => {
    let reads = 0,
      mutations = 0;
    const marker = "synthetic-connection-bearer";
    const providers = new SandboxProviders({ authorize: async () => {} });
    providers.register(
      createBoatProvider({
        apiKey: "synthetic-connection-proof",
        fetch: async (url, init) => {
          if (init?.method !== "GET") {
            mutations++;
            throw new Error("Unexpected native access mutation");
          }
          if (!String(url).endsWith("/sandboxes/connection-proof-vm"))
            throw new Error("Unexpected access lookup");
          reads++;
          return new Response(
            JSON.stringify({
              ok: true,
              sandbox: {
                id: "connection-proof-vm",
                state: "ready",
                vcpu: 2,
                archiveAfter: new Date(Date.now() + 60000).toISOString(),
                desktopUrl: `https://desktop.example.test/?_token=${marker}`,
                url: `https://service.example.test/?_token=${marker}`,
                browserUrl: `https://browser.example.test/?token=${marker}`,
                sshEndpoint: "203.0.113.10:22001",
              },
            }),
          );
        },
      }),
    );
    await ctx.runMutation(components.sandbox.registry.ensure, {
      sandbox,
      reference: { provider: "boat", providerId: "connection-proof-vm" },
    });
    const lifecycleStore = createLifecycleStore(ctx, components.sandbox);
    const refreshed = await providers
      .lifecycle(lifecycleStore)
      .refresh(sandbox);
    const images = providers.images(createImageStore(ctx, components.sandbox));
    let rejected = 0;
    for (const kind of ["preview", "desktop", "ssh", "browser"] as const) {
      try {
        await images.connection({
          sandbox,
          kind,
          expiresInMs: 1000,
          ...(kind === "preview" ? { port: 3000 } : {}),
        });
      } catch (error) {
        if (
          error instanceof SandboxProviderError &&
          error.data.code === "unsupported"
        )
          rejected++;
      }
    }
    const record = await lifecycleStore.get(sandbox);
    const serialized = JSON.stringify(record);
    return {
      unsupportedKinds: rejected === 4,
      noAccessDispatch: reads === 1 && mutations === 0,
      observationSafe:
        refreshed?.observedState === "running" &&
        refreshed?.resources?.cpuCount === 2,
      recordsSafe:
        ![marker, "https://", "expiresAt", "archiveAfter", "sshEndpoint"].some(
          (value) => serialized.includes(value),
        ) &&
        (await lifecycleStore.getOperation(sandbox, "connection")) === null,
    };
  },
});
