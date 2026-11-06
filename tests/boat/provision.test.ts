import { createHash } from "node:crypto";
import { convexTest } from "convex-test";
import { defineSchema } from "convex/server";
import { expect, test, vi } from "vitest";
import { register } from "@fantastic.dev/convex-sandbox/testing";
import {
  SandboxProviders,
  type LifecycleStore,
} from "@fantastic.dev/convex-sandbox";
import { createBoatProvider, type BoatOptions } from "../../src/boat/index.js";

const apiKey = "synthetic-create-key";
const sandbox = { scope: "fixture-account", key: "machine" };
const nativeKey = (shared: string) =>
  `csb-boat-v1-${createHash("sha256").update(shared).digest("hex")}`;
const reply = (id = "boat-1", state = "provisioning", extra = {}) =>
  new Response(
    JSON.stringify({
      ok: true,
      type: "sandbox.created",
      status: "provisioning",
      ttlSeconds: 3600,
      sandbox: { id, state, name: "private", ...extra },
    }),
    { status: 202 },
  );
const context = (idempotencyKey = "shared-operation") => ({
  idempotencyKey,
  signal: new AbortController().signal,
});

function fixture(options: BoatOptions) {
  const t = convexTest(defineSchema({}), {
    "./_generated/server.js": () =>
      import("../../example/convex/_generated/server.js"),
  });
  const c = register(t);
  const store: LifecycleStore = {
    get: (sandbox) => t.query(c.registry.get, { sandbox }),
    getOperation: (sandbox, operationId) =>
      t.query(c.operations.get, { sandbox, operationId }),
    begin: (args) => t.mutation(c.operations.begin, args),
    reserveCreate: (args) => t.mutation(c.lifecycle.reserveCreate, args),
    getProvision: (sandbox) => t.query(c.lifecycle.getProvision, { sandbox }),
    claimCreateReconciliation: (args) =>
      t.mutation(c.lifecycle.claimCreateReconciliation, args),
    finishCreate: (args) => t.mutation(c.lifecycle.finishCreate, args),
    claimOperation: (args) => t.mutation(c.lifecycle.claimOperation, args),
    finishOperation: (args) => t.mutation(c.lifecycle.finishOperation, args),
    beginRefresh: (sandbox) => t.mutation(c.registry.beginRefresh, { sandbox }),
    finishRefresh: (args) => t.mutation(c.registry.finishRefresh, args),
  };
  const provider = createBoatProvider(options);
  const sharedKeys: string[] = [];
  const create = provider.adapter.create;
  if (create)
    provider.adapter.create = (options, ctx) => {
      sharedKeys.push(ctx.idempotencyKey);
      return create(options, ctx);
    };
  const providers = new SandboxProviders({
    authorize: async () => {},
    authorizeCreate: async () => {},
  });
  providers.register(provider);
  return {
    t,
    c,
    store,
    provider,
    sharedKeys,
    lifecycle: providers.lifecycle(store),
  };
}

test("shared concurrent claims send one native request with a bounded stable shared key", async () => {
  const requests: RequestInit[] = [];
  const f = fixture({
    apiKey,
    fetch: async (_url, init = {}) => {
      requests.push(init);
      return reply();
    },
  });
  await Promise.all(
    ["first", "second"].map((operationId) =>
      f.lifecycle
        .create({ sandbox, provider: "boat", operationId })
        .catch(() => null),
    ),
  );
  expect(requests).toHaveLength(1);
  expect(f.sharedKeys).toHaveLength(1);
  expect(new Headers(requests[0].headers).get("Idempotency-Key")).toBe(
    nativeKey(f.sharedKeys[0]),
  );
  expect(await f.lifecycle.get(sandbox)).toMatchObject({
    reference: { provider: "boat", providerId: "boat-1" },
    observedState: "starting",
  });
});

test("creation sends only safe guest defaults and host-owned wallet, size and deadline", async () => {
  let url = "";
  let request: RequestInit = {};
  const provider = createBoatProvider({
    apiKey,
    org: "approved-org",
    fetch: async (input, init = {}) => {
      url = String(input);
      request = init;
      return reply();
    },
  });
  expect(provider.createIdempotency).toBe("native");
  expect(provider.adapter.findCreate).toBeUndefined();
  expect(await provider.adapter.create?.({}, context())).toEqual({
    providerId: "boat-1",
    state: "starting",
  });
  expect(url).toBe("https://boat.dev/api/v1/sandboxes?org=approved-org");
  expect(JSON.parse(String(request.body))).toEqual({
    type: "small",
    ttlSeconds: 3600,
    noEnv: true,
    snapshots: true,
    visibility: "private",
  });
  expect(new Headers(request.headers).get("X-Boat-Org")).toBe("approved-org");
});

test("long Unicode shared keys remain deterministic and within Boat's 255-byte header limit", async () => {
  const keys: string[] = [];
  const provider = createBoatProvider({
    apiKey,
    fetch: async (_url, init) => {
      keys.push(new Headers(init?.headers).get("Idempotency-Key") ?? "");
      return reply();
    },
  });
  const shared = "long-tenant-🔒".repeat(150);
  await provider.adapter.create?.({}, context(shared));
  await provider.adapter.create?.({}, context(shared));
  await provider.adapter.create?.({}, context(`${shared}-other`));
  expect(keys).toEqual([
    nativeKey(shared),
    nativeKey(shared),
    nativeKey(`${shared}-other`),
  ]);
  expect(new TextEncoder().encode(keys[0]).byteLength).toBeLessThanOrEqual(255);
  expect(keys[0]).not.toContain("tenant");
});

test("lost create replies remain unknown through replay and reconciliation even past native key expiry", async () => {
  const fetch = vi.fn(async () => {
    throw new Error(apiKey);
  });
  const f = fixture({ apiKey, fetch });
  const input = { sandbox, provider: "boat", operationId: "lost" };
  await f.lifecycle.create(input);
  const clock = vi
    .spyOn(Date, "now")
    .mockReturnValue(Date.now() + 25 * 60 * 60 * 1000);
  try {
    await f.lifecycle.create(input);
    await f.lifecycle.reconcileCreate(input);
    await expect(
      f.lifecycle.create({ ...input, operationId: "replacement" }),
    ).rejects.toThrow("Provision active");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await f.store.getProvision(sandbox)).toMatchObject({
      status: "unknown",
      idempotency: "native",
    });
    expect(await f.lifecycle.get(sandbox)).toBeNull();
    expect(JSON.stringify(await f.store.getProvision(sandbox))).not.toContain(
      apiKey,
    );
  } finally {
    clock.mockRestore();
  }
});

test("host configuration is captured and generic resources/templates are rejected before native dispatch", async () => {
  const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
    reply(),
  );
  const options: BoatOptions = {
    apiKey,
    machineType: "large",
    ttlSeconds: 120,
    fetch,
  };
  const provider = createBoatProvider(options);
  options.machineType = "xlarge";
  options.ttlSeconds = 999;
  await provider.adapter.create?.({}, context());
  expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
    type: "large",
    ttlSeconds: 120,
  });
  fetch.mockClear();
  for (const input of [
    { resources: { cpuCount: 2 } },
    { templateId: "native-template" },
  ]) {
    await expect(
      provider.adapter.create?.(input, context()),
    ).rejects.toMatchObject({
      data: { code: "unsupported", outcome: "not_started" },
    });
  }
  expect(fetch).not.toHaveBeenCalled();
});

test.each([
  { machineType: "constructor" },
  { ttlSeconds: 0 },
  { ttlSeconds: 2592001 },
  { ttlSeconds: Number.NaN },
  { ttlSeconds: null },
])(
  "invalid host provisioning configuration fails before HTTP: %j",
  (configuration) => {
    const fetch = vi.fn(async () => reply());
    expect(() =>
      createBoatProvider({ apiKey, fetch, ...configuration } as BoatOptions),
    ).toThrow("Invalid provider data");
    expect(fetch).not.toHaveBeenCalled();
  },
);

test("native CPU observations are reported without guessed memory or disk units", async () => {
  const provider = createBoatProvider({
    apiKey,
    fetch: async () =>
      reply("boat-1", "ready", { vcpu: 2, memoryGB: 4, type: "small" }),
  });
  const expected = {
    providerId: "boat-1",
    state: "running",
    resources: { cpuCount: 2 },
  };
  expect(await provider.adapter.create?.({}, context())).toEqual({
    ...expected,
    state: "starting",
  });
  expect(await provider.adapter.describe("boat-1", context())).toEqual(
    expected,
  );
});

test("malformed successful create replies retain an unknown outcome and do not leak provider data", async () => {
  for (const body of [
    "null",
    "not JSON",
    JSON.stringify({ ok: true, sandbox: { state: "ready", error: apiKey } }),
  ]) {
    const provider = createBoatProvider({
      apiKey,
      fetch: async () => new Response(body, { status: 202 }),
    });
    const error = await provider.adapter
      .create?.({}, context())
      .catch((error) => error);
    expect(error).toMatchObject({
      data: { code: "validation", outcome: "unknown", retryable: false },
    });
    expect(JSON.stringify(error)).not.toContain(apiKey);
  }
});
