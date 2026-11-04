import { v } from "convex/values";
import { internalAction } from "./_generated/server.js";
import { probeBoatSdk } from "../../scripts/boat/sdk-probe.js";
import { probeBoatTransport } from "../../scripts/boat/transport-probe.js";
import { createBoatProvider } from "@fantastic.dev/convex-sandbox/boat";
import {
  SandboxProviders,
  createLifecycleStore,
} from "@fantastic.dev/convex-sandbox";
import { components } from "./_generated/api.js";

// Internal synthetic audit fixture, never a live Boat endpoint.
export const runtime = internalAction({
  args: {},
  returns: v.object({
    injectedFetch: v.boolean(),
    requestInputs: v.boolean(),
    detachedCommand: v.boolean(),
    abortForwarded: v.boolean(),
    lostReplyNotRetried: v.boolean(),
    httpErrorsNotRetried: v.boolean(),
  }),
  handler: async () => probeBoatSdk(),
});

export const transport = internalAction({
  args: {},
  returns: v.object({
    projection: v.boolean(),
    accountScoped: v.boolean(),
    aborted: v.boolean(),
    noRawErrors: v.boolean(),
  }),
  handler: async () => probeBoatTransport(),
});

export const provision = internalAction({
  args: {},
  returns: v.object({
    createdOnce: v.boolean(),
    safeDefaults: v.boolean(),
    stableKey: v.boolean(),
    pendingThenReady: v.boolean(),
    unknownNotReplayed: v.boolean(),
    resourcesProjected: v.boolean(),
  }),
  handler: async (ctx) => {
    const store = createLifecycleStore(ctx, components.sandbox);
    const sandbox = { scope: "boat-provision-proof", key: "created" };
    const lostSandbox = { scope: "boat-provision-proof", key: "lost" };
    let creates = 0;
    let safeDefaults = false;
    let stableKey = false;
    const providers = new SandboxProviders({
      authorize: async () => {},
      authorizeCreate: async () => {},
    });
    providers.register(
      createBoatProvider({
        apiKey: "synthetic-provision-key",
        org: "fixture-wallet",
        fetch: async (_url, init) => {
          const creating = init?.method === "POST";
          if (creating) {
            creates++;
            const body = JSON.parse(String(init?.body));
            safeDefaults =
              body.noEnv === true &&
              body.visibility === "private" &&
              body.type === "small" &&
              body.ttlSeconds === 3600 &&
              body.snapshots === true;
            const headers = new Headers(init?.headers);
            stableKey =
              /^csb-boat-v1-[a-f0-9]{64}$/.test(
                headers.get("Idempotency-Key") ?? "",
              ) && headers.get("X-Boat-Org") === "fixture-wallet";
          }
          return new Response(
            JSON.stringify({
              ok: true,
              type: creating ? "sandbox.created" : "sandbox.info",
              status: creating ? "provisioning" : "ready",
              ttlSeconds: 3600,
              sandbox: {
                id: "synthetic-boat-machine",
                name: "fixture",
                state: creating ? "provisioning" : "ready",
                vcpu: 2,
                memoryGB: 4,
              },
            }),
            { status: creating ? 202 : 200 },
          );
        },
      }),
    );
    const lifecycle = providers.lifecycle(store);
    await Promise.all(
      ["first", "second"].map((operationId) =>
        lifecycle
          .create({ sandbox, provider: "boat", operationId })
          .catch(() => null),
      ),
    );
    const pending = await lifecycle.get(sandbox);
    await lifecycle.refresh(sandbox);
    const ready = await lifecycle.get(sandbox);

    let lostRequests = 0;
    const lostProviders = new SandboxProviders({
      authorize: async () => {},
      authorizeCreate: async () => {},
    });
    lostProviders.register(
      createBoatProvider({
        apiKey: "synthetic-provision-key",
        fetch: async () => {
          lostRequests++;
          throw new Error("Synthetic lost reply");
        },
      }),
    );
    const lost = lostProviders.lifecycle(store);
    const input = {
      sandbox: lostSandbox,
      provider: "boat",
      operationId: "lost",
    };
    await lost.create(input);
    await lost.create(input);
    await lost.reconcileCreate(input);
    const unknown = await store.getProvision(lostSandbox);
    return {
      createdOnce: creates === 1,
      safeDefaults,
      stableKey,
      pendingThenReady:
        pending?.observedState === "starting" &&
        ready?.observedState === "running",
      unknownNotReplayed:
        lostRequests === 1 &&
        unknown?.status === "unknown" &&
        !(await lost.get(lostSandbox)),
      resourcesProjected:
        ready?.resources?.cpuCount === 2 &&
        ready.resources.memoryMiB === undefined &&
        ready.resources.diskMiB === undefined,
    };
  },
});
