import { convexTest } from "convex-test";
import { defineSchema } from "convex/server";
import { expect, test } from "vitest";
import { register } from "@fantastic.dev/convex-sandbox/testing";

const sandbox = { scope: "scope-a", key: "machine" };
const reference = { provider: "simulated", providerId: "physical-1" };
function fixture() {
  const t = convexTest(defineSchema({}), {
    "./_generated/server.js": () =>
      import("../example/convex/_generated/server.js"),
  });
  return { t, c: register(t) };
}

test("identity is stable, references cannot be silently replaced, and scopes isolate queries", async () => {
  const { t, c } = fixture();
  const first = await t.mutation(c.registry.ensure, { sandbox, reference });
  expect(await t.mutation(c.registry.ensure, { sandbox, reference })).toEqual(
    first,
  );
  await expect(
    t.mutation(c.registry.ensure, {
      sandbox,
      reference: { ...reference, providerId: "replacement" },
    }),
  ).rejects.toThrow("Reference conflict");
  expect(
    await t.query(c.registry.get, {
      sandbox: { ...sandbox, scope: "scope-b" },
    }),
  ).toBeNull();
  const second = await t.mutation(c.registry.ensure, {
    sandbox: { ...sandbox, scope: "scope-b" },
    reference,
  });
  expect(second.scope).toBe("scope-b");
});

test("refresh tickets reject duplicates and out-of-order data; failed refresh preserves observed state", async () => {
  const { t, c } = fixture();
  await t.mutation(c.registry.ensure, { sandbox, reference });
  const old = await t.mutation(c.registry.beginRefresh, { sandbox });
  const latest = await t.mutation(c.registry.beginRefresh, { sandbox });
  expect(
    await t.mutation(c.registry.finishRefresh, {
      sandbox,
      ...latest,
      result: { state: "running" },
    }),
  ).toBe(true);
  expect(
    await t.mutation(c.registry.finishRefresh, {
      sandbox,
      ...old,
      result: { state: "stopped" },
    }),
  ).toBe(false);
  expect(
    await t.mutation(c.registry.finishRefresh, {
      sandbox,
      ...latest,
      result: { state: "stopped" },
    }),
  ).toBe(false);
  const failed = await t.mutation(c.registry.beginRefresh, { sandbox });
  const pending = await t.query(c.registry.get, { sandbox });
  expect(pending?.observedSequence).toBeLessThan(pending?.refreshSequence ?? 0);
  await t.mutation(c.registry.finishRefresh, {
    sandbox,
    ...failed,
    result: { errorCode: "timeout" },
  });
  expect(await t.query(c.registry.get, { sandbox })).toMatchObject({
    observedState: "running",
    refresh: { status: "failed", errorCode: "timeout" },
  });
});

test("deletion is a tombstone; explicit versioned rebind creates a new generation", async () => {
  const { t, c } = fixture();
  await t.mutation(c.registry.ensure, { sandbox, reference });
  const ticket = await t.mutation(c.registry.beginRefresh, { sandbox });
  await t.mutation(c.registry.finishRefresh, {
    sandbox,
    ...ticket,
    result: { state: "deleted" },
  });
  const deleted = await t.query(c.registry.get, { sandbox });
  expect(deleted?.tombstone).toBe(true);
  await expect(
    t.mutation(c.registry.beginRefresh, { sandbox }),
  ).rejects.toThrow("Sandbox deleted");
  const rebound = await t.mutation(c.registry.rebind, {
    sandbox,
    expectedVersion: deleted?.version ?? -1,
    reference: { ...reference, providerId: "physical-2" },
  });
  expect(rebound).toMatchObject({
    generation: 2,
    observedState: "unknown",
    tombstone: false,
  });
  expect(
    await t.mutation(c.registry.finishRefresh, {
      sandbox,
      ...ticket,
      result: { state: "running" },
    }),
  ).toBe(false);
});

test("requested state is separate, unknown operations block replacement and resolve without re-execution", async () => {
  const { t, c } = fixture();
  const initial = await t.mutation(c.registry.ensure, { sandbox, reference });
  const op = await t.mutation(c.operations.begin, {
    sandbox,
    expectedVersion: initial.version,
    operationId: "start-1",
    kind: "start",
  });
  expect(await t.query(c.registry.get, { sandbox })).toMatchObject({
    requestedState: "running",
    observedState: "unknown",
    activeOperationId: "start-1",
  });
  expect(
    await t.mutation(c.operations.begin, {
      sandbox,
      expectedVersion: initial.version,
      operationId: "start-1",
      kind: "start",
    }),
  ).toEqual(op);
  expect(
    await t.mutation(c.operations.transition, {
      sandbox,
      operationId: "start-1",
      expectedVersion: op.version,
      status: "unknown",
      errorCode: "timeout",
    }),
  ).toBe(true);
  const current = await t.query(c.registry.get, { sandbox });
  await expect(
    t.mutation(c.operations.begin, {
      sandbox,
      expectedVersion: current?.version ?? -1,
      operationId: "start-2",
      kind: "start",
    }),
  ).rejects.toThrow("Operation active");
  const uncertain = await t.query(c.operations.get, {
    sandbox,
    operationId: "start-1",
  });
  await expect(
    t.mutation(c.operations.transition, {
      sandbox,
      operationId: "start-1",
      expectedVersion: uncertain?.version ?? -1,
      status: "running",
    }),
  ).rejects.toThrow("Invalid operation transition");
  expect(
    await t.mutation(c.operations.transition, {
      sandbox,
      operationId: "start-1",
      expectedVersion: uncertain?.version ?? -1,
      status: "succeeded",
    }),
  ).toBe(true);
  expect(await t.query(c.registry.get, { sandbox })).toMatchObject({
    observedState: "unknown",
    requestedState: "running",
  });
});

test("optimistic versions serialize competing operations and reject stale/terminal updates", async () => {
  const { t, c } = fixture();
  const initial = await t.mutation(c.registry.ensure, { sandbox, reference });
  const starts = await Promise.allSettled(
    ["one", "two"].map((operationId) =>
      t.mutation(c.operations.begin, {
        sandbox,
        expectedVersion: initial.version,
        operationId,
        kind: "execute",
      }),
    ),
  );
  expect(starts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const winner = starts.find((r) => r.status === "fulfilled");
  if (winner?.status !== "fulfilled") throw new Error("No winner");
  const op = winner.value;
  expect(
    await t.mutation(c.operations.transition, {
      sandbox,
      operationId: op.operationId,
      expectedVersion: op.version,
      status: "running",
      executionId: "exec-1",
    }),
  ).toBe(true);
  expect(
    await t.mutation(c.operations.transition, {
      sandbox,
      operationId: op.operationId,
      expectedVersion: op.version,
      status: "failed",
    }),
  ).toBe(false);
  expect(
    await t.query(c.operations.get, {
      sandbox: { ...sandbox, scope: "scope-b" },
      operationId: op.operationId,
    }),
  ).toBeNull();
  expect(
    await t.mutation(c.operations.transition, {
      sandbox,
      operationId: op.operationId,
      expectedVersion: op.version + 1,
      status: "succeeded",
    }),
  ).toBe(true);
  await expect(
    t.mutation(c.operations.transition, {
      sandbox,
      operationId: op.operationId,
      expectedVersion: op.version + 2,
      status: "running",
    }),
  ).rejects.toThrow("Invalid operation transition");
});

test("scoped paginated machine and execution queries never include sibling scope", async () => {
  const { t, c } = fixture();
  for (const scope of ["scope-a", "scope-b"]) {
    for (const key of ["one", "two", "three"])
      await t.mutation(c.registry.ensure, {
        sandbox: { scope, key },
        reference,
      });
  }
  const first = await t.query(c.registry.list, {
    scope: "scope-a",
    paginationOpts: { numItems: 2, cursor: null },
  });
  const second = await t.query(c.registry.list, {
    scope: "scope-a",
    paginationOpts: { numItems: 2, cursor: first.continueCursor },
  });
  expect([...first.page, ...second.page].map((row) => row.scope)).toEqual([
    "scope-a",
    "scope-a",
    "scope-a",
  ]);
  expect(second.isDone).toBe(true);
  const isolated = await t.query(c.operations.executions, {
    sandbox,
    paginationOpts: { numItems: 2, cursor: null },
  });
  expect(isolated.page).toEqual([]);
});

test("operation history stays bounded without discarding unknown work", async () => {
  const { t, c } = fixture();
  await t.mutation(c.registry.ensure, { sandbox, reference });
  for (let i = 0; i < 102; i++) {
    const row = await t.query(c.registry.get, { sandbox });
    const op = await t.mutation(c.operations.begin, {
      sandbox,
      expectedVersion: row?.version ?? -1,
      operationId: `op-${i}`,
      kind: i % 2 ? "execute" : "describe",
    });
    await t.mutation(c.operations.transition, {
      sandbox,
      operationId: op.operationId,
      expectedVersion: op.version,
      status: "succeeded",
    });
  }
  expect(
    await t.query(c.operations.get, { sandbox, operationId: "op-0" }),
  ).toBeNull();
  const history = await t.query(c.operations.list, {
    sandbox,
    paginationOpts: { numItems: 100, cursor: null },
  });
  expect(history.page).toHaveLength(100);
  const executions = await t.query(c.operations.executions, {
    sandbox,
    paginationOpts: { numItems: 100, cursor: null },
  });
  expect(executions.page).toHaveLength(50);
  expect(executions.page.every((row) => row.kind === "execute")).toBe(true);
});

test("mutating operations invalidate refreshes started before a newer operation phase", async () => {
  const { t, c } = fixture();
  await t.mutation(c.registry.ensure, { sandbox, reference });
  const before = await t.mutation(c.registry.beginRefresh, { sandbox });
  const row = await t.query(c.registry.get, { sandbox });
  const op = await t.mutation(c.operations.begin, {
    sandbox,
    expectedVersion: row?.version ?? -1,
    operationId: "start-fenced",
    kind: "start",
  });
  expect(await t.query(c.registry.get, { sandbox })).toMatchObject({
    refresh: { status: "stale" },
  });
  expect(
    await t.mutation(c.registry.finishRefresh, {
      sandbox,
      ...before,
      result: { state: "stopped" },
    }),
  ).toBe(false);
  const during = await t.mutation(c.registry.beginRefresh, { sandbox });
  await t.mutation(c.operations.transition, {
    sandbox,
    operationId: op.operationId,
    expectedVersion: op.version,
    status: "succeeded",
  });
  expect(
    await t.mutation(c.registry.finishRefresh, {
      sandbox,
      ...during,
      result: { state: "stopped" },
    }),
  ).toBe(false);
});

test("query bounds and secret-shaped RPC fields are rejected before writes", async () => {
  const { t, c } = fixture();
  await expect(
    t.query(c.registry.list, {
      scope: sandbox.scope,
      paginationOpts: { numItems: 101, cursor: null },
    }),
  ).rejects.toThrow("Page size");
  const invalid = { sandbox, reference, credential: "synthetic-private-value" };
  await expect(t.mutation(c.registry.ensure, invalid)).rejects.toThrow();
  expect(await t.query(c.registry.get, { sandbox })).toBeNull();
});

test.each(["failed", "cancelled"] as const)(
  "%s is terminal and releases the operation without inventing observed state",
  async (status) => {
    const { t, c } = fixture();
    const initial = await t.mutation(c.registry.ensure, { sandbox, reference });
    const op = await t.mutation(c.operations.begin, {
      sandbox,
      expectedVersion: initial.version,
      operationId: "terminal",
      kind: "start",
    });
    await t.mutation(c.operations.transition, {
      sandbox,
      operationId: op.operationId,
      expectedVersion: op.version,
      status,
      errorCode: "capacity",
    });
    expect(
      await t.query(c.operations.get, { sandbox, operationId: op.operationId }),
    ).toMatchObject({ status, errorCode: "capacity" });
    const row = await t.query(c.registry.get, { sandbox });
    expect(row?.activeOperationId).toBeUndefined();
    expect(row?.observedState).toBe("unknown");
    await expect(
      t.mutation(c.operations.transition, {
        sandbox,
        operationId: op.operationId,
        expectedVersion: op.version + 1,
        status: "running",
      }),
    ).rejects.toThrow("Invalid operation transition");
  },
);

test("deleted machines cannot be rebound while an operation still has unknown outcome", async () => {
  const { t, c } = fixture();
  const initial = await t.mutation(c.registry.ensure, { sandbox, reference });
  const op = await t.mutation(c.operations.begin, {
    sandbox,
    expectedVersion: initial.version,
    operationId: "delete",
    kind: "delete",
  });
  await t.mutation(c.operations.transition, {
    sandbox,
    operationId: op.operationId,
    expectedVersion: op.version,
    status: "unknown",
  });
  const ticket = await t.mutation(c.registry.beginRefresh, { sandbox });
  await t.mutation(c.registry.finishRefresh, {
    sandbox,
    ...ticket,
    result: { state: "deleted" },
  });
  const row = await t.query(c.registry.get, { sandbox });
  await expect(
    t.mutation(c.registry.rebind, {
      sandbox,
      expectedVersion: row?.version ?? -1,
      reference: { ...reference, providerId: "new" },
    }),
  ).rejects.toThrow("Rebind requires resolved deletion");
});
