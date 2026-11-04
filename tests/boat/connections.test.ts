import { convexTest } from "convex-test";
import { defineSchema } from "convex/server";
import { expect, test } from "vitest";
import {
  register,
  createTestStores,
} from "@fantastic.dev/convex-sandbox/testing";
import {
  SandboxProviders,
  SandboxProviderError,
  type ConnectionKind,
} from "@fantastic.dev/convex-sandbox";
import { createBoatProvider } from "@fantastic.dev/convex-sandbox/boat";

const sandbox = { scope: "boat-connection-fixture", key: "machine" };
const marker = "synthetic-bearer-marker";
async function fixture(ttlSeconds = 60) {
  const calls: Array<{ url: string; method: string | undefined }> = [];
  const authorizations: string[] = [];
  const state = { deny: false };
  const provider = createBoatProvider({
    apiKey: "synthetic-connection-key",
    ttlSeconds,
    fetch: async (url, init) => {
      calls.push({ url: String(url), method: init?.method });
      if (
        init?.method !== "GET" ||
        !String(url).endsWith("/sandboxes/connection-vm")
      )
        throw new Error("Unexpected native connection dispatch");
      return new Response(
        JSON.stringify({
          ok: true,
          sandbox: {
            id: "connection-vm",
            state: "ready",
            vcpu: 2,
            ttlSeconds,
            archiveAfter: new Date(Date.now() + 60000).toISOString(),
            url: `https://machine.example.test/?_token=${marker}`,
            desktopAvailable: true,
            desktopUrl: `https://desktop.example.test/?_token=${marker}`,
            sshEndpoint: "203.0.113.10:22001",
            sshUser: "user",
            browserUrl: `https://browser.example.test/?token=${marker}`,
            servicePreviewToken: marker,
          },
        }),
      );
    },
  });
  const t = convexTest(defineSchema({}), {
    "./_generated/server.js": () =>
      import("../../example/convex/_generated/server.js"),
  });
  const c = register(t),
    stores = createTestStores(t, c, () => true);
  await t.mutation(c.registry.ensure, {
    sandbox,
    reference: { provider: "boat", providerId: "connection-vm" },
  });
  const providers = new SandboxProviders({
    authorize: async ({ operation }) => {
      authorizations.push(operation);
      if (state.deny)
        throw new SandboxProviderError({
          code: "authorization",
          outcome: "not_started",
          retryable: false,
        });
    },
  });
  providers.register(provider);
  return {
    calls,
    authorizations,
    state,
    provider,
    stores,
    images: providers.images(stores.images),
    lifecycle: providers.lifecycle(stores.lifecycle),
  };
}

test.each(["preview", "desktop", "ssh", "browser"] as const)(
  "Boat %s access fails unsupported without minting a handle or dispatching native setup",
  async (kind) => {
    const f = await fixture(),
      before = await f.stores.lifecycle.get(sandbox);
    await expect(
      f.images.connection({
        sandbox,
        kind,
        expiresInMs: 1000,
        ...(kind === "preview" ? { port: 3000 } : {}),
      }),
    ).rejects.toMatchObject({
      data: {
        code: "unsupported",
        capability: "getConnection",
        outcome: "not_started",
      },
    });
    expect(f.authorizations).toEqual(["getConnection"]);
    expect(f.calls).toHaveLength(0);
    expect(f.provider.capabilities?.supported).not.toContain("getConnection");
    expect(f.provider.adapter.connections).toBeUndefined();
    expect(await f.stores.lifecycle.get(sandbox)).toEqual(before);
    expect(
      await f.stores.lifecycle.getOperation(sandbox, "connection"),
    ).toBeNull();
  },
);

test("machine TTL and archiveAfter never become fabricated connection expiry or durable bearer metadata", async () => {
  const f = await fixture(120);
  const refreshed = await f.lifecycle.refresh(sandbox);
  expect(refreshed).toMatchObject({
    observedState: "running",
    resources: { cpuCount: 2 },
  });
  const record = await f.stores.lifecycle.get(sandbox),
    serialized = JSON.stringify(record);
  for (const denied of [
    marker,
    "desktopUrl",
    "browserUrl",
    "sshEndpoint",
    "servicePreviewToken",
    "archiveAfter",
    "expiresAt",
    "https://",
  ])
    expect(serialized).not.toContain(denied);
  await expect(
    f.images.connection({ sandbox, kind: "desktop", expiresInMs: 60000 }),
  ).rejects.toMatchObject({ data: { code: "unsupported" } });
  expect(f.calls).toEqual([
    { url: "https://boat.dev/api/v1/sandboxes/connection-vm", method: "GET" },
  ]);
  expect(await f.stores.lifecycle.get(sandbox)).toEqual(record);
});

test("host authorization still precedes the unsupported-capability result", async () => {
  const f = await fixture();
  f.state.deny = true;
  await expect(
    f.images.connection({ sandbox, kind: "preview", port: 3000 }),
  ).rejects.toMatchObject({ data: { code: "authorization" } });
  expect(f.authorizations).toEqual(["getConnection"]);
  expect(f.calls).toHaveLength(0);
});

test("an unknown kind is rejected without authorizing or dispatching a substitute", async () => {
  const f = await fixture();
  await expect(
    f.images.connection({ sandbox, kind: "serial" as ConnectionKind }),
  ).rejects.toThrow("Invalid connection kind");
  expect(f.authorizations).toEqual([]);
  expect(f.calls).toHaveLength(0);
});
