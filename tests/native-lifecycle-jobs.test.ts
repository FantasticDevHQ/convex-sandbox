import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import { defineSchema } from "convex/server";
import { expect, test, vi } from "vitest";
import {
  register,
  createTestStores,
} from "@fantastic.dev/convex-sandbox/testing";
import {
  SandboxProviders,
  type ProviderCallContext,
  type SandboxAdapter,
} from "@fantastic.dev/convex-sandbox";

const sandbox = { scope: "native-job-fixture", key: "machine" };
const reference = { provider: "async-fixture", providerId: "native-vm" };

async function fixture() {
  const t = convexTest(defineSchema({}), {
    "./_generated/server.js": () =>
      import("../example/convex/_generated/server.js"),
  });
  const c = register(t);
  const store = createTestStores(t, c, () => true).lifecycle;
  await t.mutation(c.registry.ensure, { sandbox, reference });
  let mutations = 0;
  let completed = false;
  const contexts: Array<ProviderCallContext | undefined> = [];
  const adapter: SandboxAdapter = {
    delete: async () => {
      mutations++;
      return {
        providerId: reference.providerId,
        state: "stopping",
        lifecycleJob: { id: "native-job", token: "synthetic-private-extra" },
      };
    },
    describe: async (_id, context) => {
      contexts.push(context);
      return {
        providerId: reference.providerId,
        state: completed ? "deleted" : "stopping",
        lifecycleJob: { id: "native-job" },
      };
    },
  };
  const client = () => {
    const providers = new SandboxProviders({ authorize: async () => {} });
    providers.register({
      name: reference.provider,
      adapter,
      capabilities: { version: 1, supported: ["describe", "delete"] },
    });
    return providers.lifecycle(store);
  };
  return {
    t,
    c,
    store,
    adapter,
    client,
    contexts,
    complete: () => {
      completed = true;
    },
    mutations: () => mutations,
  };
}

test("accepted native handles persist and a new client reconciles them without mutation replay", async () => {
  const f = await fixture();
  const op = await f
    .client()
    .run({ sandbox, action: "delete", operationId: "delete" });
  expect(op).toMatchObject({
    status: "unknown",
    nativeLifecycle: { id: "native-job" },
  });
  expect(JSON.stringify(op)).not.toContain("synthetic-private-extra");
  await f
    .client()
    .reconcile({ sandbox, operationId: "delete", policy: { maxAttempts: 1 } });
  expect(f.contexts.at(-1)?.lifecycleJob).toEqual({
    id: "native-job",
    kind: "delete",
  });
  expect((await f.store.get(sandbox))?.tombstone).toBe(false);
  f.complete();
  expect(
    await f.client().reconcile({
      sandbox,
      operationId: "delete",
      policy: { maxAttempts: 1 },
    }),
  ).toMatchObject({
    status: "succeeded",
    nativeLifecycle: { id: "native-job" },
  });
  expect((await f.store.get(sandbox))?.tombstone).toBe(true);
  expect(f.mutations()).toBe(1);
});

test("a newer observation suppresses stale state but does not lose an accepted native job", async () => {
  const f = await fixture();
  const finish = f.store.finishOperation;
  f.store.finishOperation = async (args) => {
    const ticket = await f.store.beginRefresh(sandbox);
    await f.store.finishRefresh({
      sandbox,
      ...ticket,
      result: { state: "running" },
    });
    return finish(args);
  };
  const op = await f
    .client()
    .run({ sandbox, action: "delete", operationId: "raced" });
  expect(op).toMatchObject({
    status: "unknown",
    nativeLifecycle: { id: "native-job" },
  });
  expect((await f.store.get(sandbox))?.observedState).toBe("running");
});

test("generic transitions cannot complete an operation owned by native lifecycle reconciliation", async () => {
  const f = await fixture();
  const op = await f
    .client()
    .run({ sandbox, action: "delete", operationId: "delete" });
  await expect(
    f.t.mutation(f.c.operations.transition, {
      sandbox,
      operationId: "delete",
      expectedVersion: op?.version ?? -1,
      status: "succeeded",
    }),
  ).rejects.toThrow("lifecycle");
  expect((await f.store.getOperation(sandbox, "delete"))?.status).toBe(
    "unknown",
  );
});

test("stale, expired and changed-identity publications cannot overwrite the job", async () => {
  const f = await fixture();
  const op = await f
    .client()
    .run({ sandbox, action: "delete", operationId: "delete" });
  const claim = await f.store.claimOperation({
    sandbox,
    operationId: "delete",
    expectedVersion: op?.version ?? -1,
    mode: "reconcile",
  });
  const changed = {
    description: {
      providerId: reference.providerId,
      state: "deleted" as const,
      lifecycleJob: { id: "foreign-job" },
    },
  };
  expect(
    await f.store.finishOperation({
      sandbox,
      operationId: "delete",
      expectedVersion: op?.version ?? -1,
      result: changed,
    }),
  ).toBe(false);
  await expect(
    f.store.finishOperation({
      sandbox,
      operationId: "delete",
      expectedVersion: claim?.version ?? -1,
      result: changed,
    }),
  ).rejects.toThrow("identity");
  assert(claim?.leaseUntil);
  const clock = vi
    .spyOn(Date, "now")
    .mockReturnValue((claim?.leaseUntil ?? 0) + 1);
  try {
    expect(
      await f.store.finishOperation({
        sandbox,
        operationId: "delete",
        expectedVersion: claim?.version ?? -1,
        result: {
          description: {
            ...changed.description,
            lifecycleJob: { id: "native-job" },
          },
        },
      }),
    ).toBe(false);
  } finally {
    clock.mockRestore();
  }
  expect(
    (await f.store.getOperation(sandbox, "delete"))?.nativeLifecycle,
  ).toEqual({ id: "native-job" });
  expect((await f.store.get(sandbox))?.tombstone).toBe(false);
});

test.each([
  "",
  "x".repeat(1025),
  "https://native.invalid/status?token=synthetic-private",
])(
  "invalid or URL-shaped handles stay out of operation records: %s",
  async (id) => {
    const f = await fixture();
    f.adapter.delete = async () => ({
      providerId: reference.providerId,
      state: "stopping",
      lifecycleJob: { id },
    });
    const result = await f
      .client()
      .run({ sandbox, action: "delete", operationId: "delete" });
    expect(result).toMatchObject({
      status: "unknown",
      errorCode: "validation",
    });
    expect(result?.nativeLifecycle).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("synthetic-private");
  },
);

test("late publication cannot alter a rebound generation or rewrite its historical job", async () => {
  const f = await fixture();
  await f.client().run({ sandbox, action: "delete", operationId: "delete" });
  f.complete();
  const complete = await f
    .client()
    .reconcile({ sandbox, operationId: "delete", policy: { maxAttempts: 1 } });
  const old = await f.store.get(sandbox);
  await f.t.mutation(f.c.registry.rebind, {
    sandbox,
    expectedVersion: old?.version ?? -1,
    reference: { ...reference, providerId: "replacement-vm" },
  });
  expect(
    await f.store.finishOperation({
      sandbox,
      operationId: "delete",
      expectedVersion: complete?.version ?? -1,
      result: {
        description: {
          providerId: reference.providerId,
          state: "deleted",
          lifecycleJob: { id: "native-job" },
        },
      },
    }),
  ).toBe(false);
  expect(await f.store.get(sandbox)).toMatchObject({
    generation: 2,
    tombstone: false,
    reference: { providerId: "replacement-vm" },
  });
  expect(
    (await f.store.getOperation(sandbox, "delete"))?.nativeLifecycle,
  ).toEqual({ id: "native-job" });
});

test("creation rejects lifecycle job metadata instead of binding a partial result", async () => {
  const f = await fixture();
  const created = { ...sandbox, key: "new-machine" };
  const providers = new SandboxProviders({
    authorize: async () => {},
    authorizeCreate: async () => {},
  });
  providers.register({
    name: reference.provider,
    createIdempotency: "native",
    capabilities: { version: 1, supported: ["create", "describe"] },
    adapter: {
      describe: f.adapter.describe,
      create: async () => ({
        providerId: "new-vm",
        state: "starting",
        lifecycleJob: { id: "not-a-provisioning-protocol" },
      }),
    },
  });
  await providers
    .lifecycle(f.store)
    .create({
      sandbox: created,
      provider: reference.provider,
      operationId: "create",
    });
  expect(await f.store.getProvision(created)).toMatchObject({
    status: "unknown",
    errorCode: "validation",
  });
  expect(await f.store.get(created)).toBeNull();
  const claim = await f.store.claimCreateReconciliation({
    sandbox: created,
    operationId: "create",
  });
  await expect(
    f.store.finishCreate({
      sandbox: created,
      operationId: "create",
      expectedVersion: claim?.version ?? -1,
      result: {
        description: {
          providerId: "new-vm",
          state: "starting",
          lifecycleJob: { id: "not-a-provisioning-protocol" },
        },
      },
    }),
  ).rejects.toThrow("creation");
});

test("a job-aware read must return matching job identity before confirming deletion", async () => {
  const f = await fixture();
  await f.client().run({ sandbox, action: "delete", operationId: "delete" });
  f.adapter.describe = async () => ({
    providerId: reference.providerId,
    state: "deleted",
  });
  const result = await f
    .client()
    .reconcile({ sandbox, operationId: "delete", policy: { maxAttempts: 1 } });
  expect(result).toMatchObject({
    status: "unknown",
    errorCode: "validation",
    nativeLifecycle: { id: "native-job" },
  });
  expect((await f.store.get(sandbox))?.tombstone).toBe(false);
});
