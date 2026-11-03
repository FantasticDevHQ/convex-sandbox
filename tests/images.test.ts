import { convexTest } from "convex-test";
import { defineSchema } from "convex/server";
import { expect, test, vi } from "vitest";
import { register } from "@fantastic.dev/convex-sandbox/testing";
import {
  SandboxProviders,
  registerProvider,
  type ImageAdapter,
  type ImageStore,
  type ConnectionAdapter,
} from "@fantastic.dev/convex-sandbox";

const sandbox = { scope: "scope-a", key: "machine" };
const image = {
  provider: "fixture",
  id: "disk-1",
  kind: "disk-snapshot" as const,
};
function fixture(
  overrides: Partial<ImageAdapter> = {},
  connections?: ConnectionAdapter,
) {
  const t = convexTest(defineSchema({}), {
    "./_generated/server.js": () =>
      import("../example/convex/_generated/server.js"),
  });
  const c = register(t);
  const store: ImageStore = {
    getSandbox: (sandbox) => t.query(c.registry.get, { sandbox }),
    getOperation: (handle) => t.query(c.operations.get, handle),
    reserve: (args) => t.mutation(c.images.reserve, args),
    claim: (args) => t.mutation(c.images.claim, args),
    publish: (args) => t.mutation(c.images.publish, args),
  };
  const providers = new SandboxProviders({
    authorize: async () => {},
    authorizeCreate: async () => {},
  });
  const sdk: ImageAdapter = {
    snapshotDisk: async () => ({ state: "pending", operationId: "native-job" }),
    createTemplate: async () => ({
      state: "ready",
      result: {
        image: { provider: "fixture", id: "template-1", kind: "template" },
      },
    }),
    fork: async () => ({
      state: "ready",
      result: { machine: { provider: "fixture", providerId: "forked-vm" } },
    }),
    restore: async () => ({ state: "ready", result: { restored: true } }),
    status: async () => ({ state: "ready", result: { image } }),
    listTemplates: async () => ({
      items: [{ reference: image, readiness: "ready" }],
      nextCursor: null,
      complete: true,
    }),
    ...overrides,
  };
  providers.register(
    registerProvider({
      name: "fixture",
      adapter: {
        describe: async (providerId) => ({ providerId, state: "running" }),
        images: sdk,
        connections,
      },
      capabilities: {
        version: 1,
        supported: [
          "snapshotDisk",
          "createTemplate",
          "fork",
          "restore",
          "listTemplates",
          "getConnection",
        ],
      },
    }),
  );
  return {
    t,
    c,
    store,
    providers,
    client: providers.images(store),
    setup: () =>
      t.mutation(c.registry.ensure, {
        sandbox,
        reference: { provider: "fixture", providerId: "vm-1" },
      }),
  };
}

test("snapshot jobs use shared operation state and readiness advances without dispatching twice", async () => {
  let starts = 0;
  const f = fixture({
    snapshotDisk: async () => {
      starts++;
      return { state: "pending", operationId: "native-job" };
    },
  });
  await f.setup();
  const request = {
    sandbox,
    operationId: "snapshot",
    kind: "snapshotDisk" as const,
  };
  const started = await f.client.run(request);
  expect(started).toMatchObject({
    status: "running",
    nativeImage: { providerOperationId: "native-job" },
  });
  await f.client.run(request);
  expect(starts).toBe(1);
  const done = await f.client.status({ sandbox, operationId: "snapshot" });
  expect(done).toMatchObject({
    status: "succeeded",
    nativeImage: { result: { image } },
  });
  expect(
    await f.t.query(f.c.operations.get, { sandbox, operationId: "snapshot" }),
  ).toEqual(done);
  expect(await f.t.query(f.c.registry.get, { sandbox })).not.toHaveProperty(
    "activeOperationId",
  );
});

test("concurrent snapshot starts dispatch exactly once", async () => {
  let calls = 0;
  const f = fixture({
    snapshotDisk: async () => {
      calls++;
      return { state: "pending", operationId: "job" };
    },
  });
  await f.setup();
  await Promise.all(
    [1, 2].map(() =>
      f.client.run({ sandbox, operationId: "same", kind: "snapshotDisk" }),
    ),
  );
  expect(calls).toBe(1);
});

test("fork, template creation and restore keep distinct native results", async () => {
  const f = fixture();
  await f.setup();
  expect(
    await f.client.run({ sandbox, operationId: "fork", kind: "fork" }),
  ).toMatchObject({
    status: "succeeded",
    nativeImage: {
      result: { machine: { provider: "fixture", providerId: "forked-vm" } },
    },
  });
  expect(
    await f.client.run({
      sandbox,
      operationId: "template",
      kind: "createTemplate",
    }),
  ).toMatchObject({
    status: "succeeded",
    nativeImage: { result: { image: { kind: "template" } } },
  });
  expect(
    await f.client.run({
      sandbox,
      operationId: "restore",
      kind: "restore",
      image,
    }),
  ).toMatchObject({
    status: "succeeded",
    nativeImage: { source: image, result: { restored: true } },
  });
  expect((await f.store.getSandbox(sandbox))?.reference.providerId).toBe(
    "vm-1",
  );
});

test("cross-provider restore and snapshot results cannot silently switch providers", async () => {
  const f = fixture({
    snapshotDisk: async () => ({
      state: "ready",
      result: { image: { ...image, provider: "other" } },
    }),
  });
  await f.setup();
  await expect(
    f.client.run({
      sandbox,
      operationId: "restore",
      kind: "restore",
      image: { ...image, provider: "other" },
    }),
  ).rejects.toThrow("Image provider conflict");
  expect(
    await f.client.run({
      sandbox,
      operationId: "snapshot",
      kind: "snapshotDisk",
    }),
  ).toMatchObject({ status: "unknown", errorCode: "validation" });
});

test("lost replies retain unknown state and never redispatch a mutation", async () => {
  let calls = 0;
  const f = fixture({
    snapshotDisk: async () => {
      calls++;
      throw new Error("credential=private");
    },
  });
  await f.setup();
  const request = {
    sandbox,
    operationId: "lost",
    kind: "snapshotDisk" as const,
  };
  expect(await f.client.run(request)).toMatchObject({
    status: "unknown",
    errorCode: "unknown_outcome",
  });
  await f.client.run(request);
  await f.client.status({ sandbox, operationId: "lost" });
  expect(calls).toBe(1);
  expect(
    JSON.stringify(await f.client.get({ sandbox, operationId: "lost" })),
  ).not.toContain("private");
});

test("read-only native lookup can recover a lost start without retry", async () => {
  const f = fixture({
    snapshotDisk: async () => {
      throw new Error("lost");
    },
    find: async () => ({ state: "ready", result: { image } }),
  });
  await f.setup();
  await f.client.run({ sandbox, operationId: "lost", kind: "snapshotDisk" });
  expect(await f.client.status({ sandbox, operationId: "lost" })).toMatchObject(
    { status: "succeeded" },
  );
});

test("missing native snapshot and desktop methods are explicit unsupported errors", async () => {
  const f = fixture(
    { snapshotDisk: undefined },
    {
      kinds: ["preview"],
      get: async () => {
        throw new Error("must not run");
      },
    },
  );
  await f.setup();
  await expect(
    f.client.run({ sandbox, operationId: "unsupported", kind: "snapshotDisk" }),
  ).rejects.toMatchObject({ data: { code: "unsupported" } });
  await expect(
    f.client.connection({ sandbox, kind: "desktop" }),
  ).rejects.toMatchObject({ data: { code: "unsupported" } });
  expect(
    await f.store.getOperation({ sandbox, operationId: "unsupported" }),
  ).toBeNull();
});

test("connection handles carry expiry and access requirements without entering reactive state", async () => {
  const f = fixture(
    {},
    {
      kinds: ["desktop"],
      get: async (_, request) => ({
        kind: "desktop",
        url: "https://desktop.example.test/signed",
        expiresAt: Date.now() + request.expiresInMs - 100,
        access: { kind: "token", token: "synthetic-secret" },
      }),
    },
  );
  await f.setup();
  expect(
    await f.client.connection({ sandbox, kind: "desktop", expiresInMs: 10000 }),
  ).toMatchObject({
    kind: "desktop",
    access: { kind: "token", token: "synthetic-secret" },
  });
  expect(JSON.stringify(await f.store.getSandbox(sandbox))).not.toContain(
    "synthetic-secret",
  );
  expect(
    (
      await f.t.query(f.c.operations.list, {
        sandbox,
        paginationOpts: { cursor: null, numItems: 10 },
      })
    ).page,
  ).toHaveLength(0);
});

test.each(["expired", "wrong-kind", "too-long", "http", "missing-token"])(
  "invalid native connection metadata is rejected: %s",
  async (scenario) => {
    const f = fixture(
      {},
      {
        kinds: ["desktop"],
        get: async () => ({
          kind: scenario === "wrong-kind" ? "browser" : "desktop",
          url:
            scenario === "http"
              ? "http://desktop.example.test"
              : "https://desktop.example.test",
          expiresAt:
            Date.now() +
            (scenario === "expired"
              ? -1
              : scenario === "too-long"
                ? 3600000
                : 1000),
          access:
            scenario === "missing-token"
              ? { kind: "token" }
              : { kind: "public" },
        }),
      },
    );
    await f.setup();
    await expect(
      f.client.connection({ sandbox, kind: "desktop" }),
    ).rejects.toThrow("Invalid connection handle");
  },
);

test("template listings project native identifiers and readiness, omitting SDK secrets", async () => {
  const f = fixture({
    listTemplates: async () => ({
      items: [
        {
          reference: image,
          readiness: "pending",
          url: "https://secret.example.test",
        },
      ],
      nextCursor: "page-2",
      complete: false,
    }),
  });
  await f.setup();
  const page = await f.client.listTemplates({ sandbox, limit: 1 });
  expect(page).toEqual({
    items: [{ reference: image, readiness: "pending" }],
    nextCursor: "page-2",
    partial: true,
  });
});

test("image state protocol rejects generic transitions and conflicting restore identity", async () => {
  const f = fixture({
    restore: async () => ({ state: "pending", operationId: "restore-job" }),
  });
  await f.setup();
  const op = await f.client.run({
    sandbox,
    operationId: "restore",
    kind: "restore",
    image,
  });
  await expect(
    f.t.mutation(f.c.operations.transition, {
      sandbox,
      operationId: "restore",
      expectedVersion: op.version,
      status: "succeeded",
    }),
  ).rejects.toThrow("Use the image state protocol");
  await expect(
    f.client.run({
      sandbox,
      operationId: "restore",
      kind: "restore",
      image: { ...image, id: "other" },
    }),
  ).rejects.toThrow("Image operation identity conflict");
});

test("an expired start lease permits lookup only, never a second dispatch", async () => {
  vi.useFakeTimers();
  try {
    let calls = 0;
    const f = fixture({
      snapshotDisk: async () => {
        calls++;
        return new Promise(() => {});
      },
    });
    await f.setup();
    const work = f.client.run({
      sandbox,
      operationId: "timeout",
      kind: "snapshotDisk",
    });
    await vi.advanceTimersByTimeAsync(5001);
    expect(await work).toMatchObject({ status: "unknown" });
    await f.client.status({ sandbox, operationId: "timeout" });
    expect(calls).toBe(1);
  } finally {
    vi.useRealTimers();
  }
});

test("create-from-template requires its own capability before native creation", async () => {
  let creates = 0;
  const f = fixture();
  f.providers.register(
    registerProvider({
      name: "create-only",
      createIdempotency: "none",
      capabilities: { version: 1, supported: ["create"] },
      adapter: {
        describe: async (providerId) => ({ providerId, state: "running" }),
        create: async () => {
          creates++;
          return { providerId: "new", state: "running" };
        },
      },
    }),
  );
  const { createLifecycleStore } =
    await import("@fantastic.dev/convex-sandbox");
  const client = f.providers.lifecycle(
    createLifecycleStore(
      {
        runQuery: (...args) => f.t.query(...args),
        runMutation: (...args) => f.t.mutation(...args),
      },
      f.c,
    ),
  );
  await expect(
    client.create({
      sandbox,
      operationId: "create",
      provider: "create-only",
      options: { templateId: "template-1" },
    }),
  ).rejects.toMatchObject({
    data: { code: "unsupported", capability: "createFromTemplate" },
  });
  expect(creates).toBe(0);
});

test("lifecycle claims cannot take over an image readiness lease", async () => {
  const f = fixture();
  await f.setup();
  const op = await f.client.run({
    sandbox,
    operationId: "snapshot",
    kind: "snapshotDisk",
  });
  await expect(
    f.t.mutation(f.c.lifecycle.claimOperation, {
      sandbox,
      operationId: "snapshot",
      expectedVersion: op.version,
      mode: "reconcile",
    }),
  ).rejects.toThrow("Use the image state protocol");
});

test("readiness failures are terminal and cannot be re-dispatched", async () => {
  let calls = 0;
  const f = fixture({
    snapshotDisk: async () => {
      calls++;
      return { state: "pending", operationId: "job" };
    },
    status: async () => ({ state: "failed" }),
  });
  await f.setup();
  const request = {
    sandbox,
    operationId: "snapshot",
    kind: "snapshotDisk" as const,
  };
  await f.client.run(request);
  expect(await f.client.status(request)).toMatchObject({ status: "failed" });
  await f.client.run(request);
  expect(calls).toBe(1);
});

test("image leases reject stale publication and status cannot claim a mutation never started", async () => {
  const f = fixture();
  await f.setup();
  const row = await f.store.getSandbox(sandbox);
  if (!row) throw new Error("Missing fixture");
  await f.store.reserve({
    sandbox,
    operationId: "snapshot",
    kind: "snapshotDisk",
    expectedVersion: row.version,
  });
  expect(
    await f.store.claim({ sandbox, operationId: "snapshot", mode: "status" }),
  ).toBeNull();
  const claim = await f.store.claim({
    sandbox,
    operationId: "snapshot",
    mode: "start",
  });
  if (!claim) throw new Error("Missing claim");
  expect(
    await f.store.publish({
      sandbox,
      operationId: "snapshot",
      expectedVersion: claim.version - 1,
      result: { state: "ready", result: { image } },
    }),
  ).toBe(false);
  expect(
    await f.store.publish({
      sandbox,
      operationId: "snapshot",
      expectedVersion: claim.version,
      result: { state: "pending", operationId: "job" },
    }),
  ).toBe(true);
  const statusClaim = await f.store.claim({
    sandbox,
    operationId: "snapshot",
    mode: "status",
  });
  if (!statusClaim) throw new Error("Missing status claim");
  await expect(
    f.store.publish({
      sandbox,
      operationId: "snapshot",
      expectedVersion: statusClaim.version,
      result: { errorCode: "capacity", notStarted: true },
    }),
  ).rejects.toThrow("Status cannot prove a mutation never started");
});

test("changed native job identity is rejected without losing the original handle", async () => {
  const f = fixture({
    status: async () => ({ state: "pending", operationId: "different-job" }),
  });
  await f.setup();
  await f.client.run({
    sandbox,
    operationId: "snapshot",
    kind: "snapshotDisk",
  });
  expect(
    await f.client.status({ sandbox, operationId: "snapshot" }),
  ).toMatchObject({
    status: "unknown",
    errorCode: "validation",
    nativeImage: { providerOperationId: "native-job" },
  });
});

test("advertised create-from-template dispatches the selected provider's template ID", async () => {
  let received: string | undefined;
  const f = fixture();
  f.providers.register(
    registerProvider({
      name: "templated",
      createIdempotency: "none",
      capabilities: { version: 1, supported: ["create", "createFromTemplate"] },
      adapter: {
        describe: async (providerId) => ({ providerId, state: "running" }),
        create: async (options) => {
          received = options.templateId;
          return { providerId: "templated-vm", state: "running" };
        },
      },
    }),
  );
  const { createLifecycleStore } =
    await import("@fantastic.dev/convex-sandbox");
  const client = f.providers.lifecycle(
    createLifecycleStore(
      {
        runQuery: (...args) => f.t.query(...args),
        runMutation: (...args) => f.t.mutation(...args),
      },
      f.c,
    ),
  );
  expect(
    await client.create({
      sandbox,
      operationId: "create",
      provider: "templated",
      options: { templateId: "native-template" },
    }),
  ).toMatchObject({ kind: "provision", provision: { status: "succeeded" } });
  expect(received).toBe("native-template");
});
