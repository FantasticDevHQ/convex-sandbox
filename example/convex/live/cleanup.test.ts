import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { register } from "@fantastic.dev/convex-sandbox/testing";
import { test, expect, vi, afterEach } from "vitest";
import schema from "../schema";
const status = makeFunctionReference<"query">("live/cleanup:status"),
  clean = makeFunctionReference<"action">("live/cleanup:requestNext"),
  inspect = makeFunctionReference<"action">("live/cleanup:inspectNext"),
  reset = makeFunctionReference<"mutation">("live/cleanup:resetView");
const issuer = "https://synthetic.clerk.accounts.dev";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
async function fixture(child = false) {
  vi.stubEnv(
    "EXAMPLE_OPERATOR_GRANTS",
    JSON.stringify(
      ["a", "b"].map((subject) => ({ issuer, subject, scope: subject })),
    ),
  );
  vi.stubEnv("BOAT_API_KEY", "synthetic-cleanup");
  vi.stubEnv("BOAT_ORG", "personal");
  const cleanup = await import("./cleanup"),
    deletion = await import("./delete"),
    allowance = await import("./allowance"),
    recovery = await import("./recovery");
  const t = convexTest(schema, {
    "./_generated/server.js": () => import("../_generated/server.js"),
    "./live/cleanup.ts": async () => cleanup,
    "./live/delete.ts": async () => deletion,
    "./live/allowance.ts": async () => allowance,
    "./live/recovery.ts": async () => recovery,
  });
  const c = register(t),
    a = t.withIdentity({ issuer, subject: "a" }),
    b = t.withIdentity({ issuer, subject: "b" });
  const scope = "example-boat:a",
    runId = "synthetic-run";
  const approvalId = await t.run((ctx) =>
    ctx.db.insert("liveApprovals", {
      scope,
      plan: {
        runId,
        scope,
        accountId: "synthetic-account",
        wallet: "personal",
        walletTeamId: null,
        size: "small",
        expiresAt: 1,
        maxMachines: 2,
        maxStarts: 4,
        maxConcurrent: 2,
        durationMinutes: 1,
        estimateUsd: 0.1,
        allowanceUsd: 1,
      },
      reviewToken: "synthetic",
      approvedAt: 1,
      approvedBy: { issuer, subject: "a" },
      machinesReserved: child ? 2 : 1,
      startsReserved: child ? 2 : 1,
      activeReservations: child ? 2 : 1,
      estimatedUsdReserved: 0.1,
    }),
  );
  await t.run((ctx) =>
    ctx.db.insert("liveReservations", {
      scope,
      runId,
      intentKey: "create-parent",
      machineKey: "parent",
      kind: "create",
      status: "reserved",
      approvalId,
      estimatedUsd: 0.1,
      createdAt: 1,
    }),
  );
  const sandbox = { scope, key: "parent" };
  const admission = await t.mutation(c.lifecycle.reserveCreate, {
    sandbox,
    provider: "boat",
    operationId: "create-parent",
    idempotency: "native",
  });
  if (admission.kind !== "provision") throw Error("Expected provision");
  await t.mutation(c.lifecycle.finishCreate, {
    sandbox,
    operationId: "create-parent",
    expectedVersion: admission.provision.version,
    result: { description: { providerId: "native-parent", state: "stopped" } },
  });
  await t.mutation(c.registry.ensure, {
    sandbox: { scope, key: "unrelated" },
    reference: { provider: "boat", providerId: "native-unrelated" },
  });
  if (child)
    await t.run((ctx) =>
      ctx.db.insert("liveReservations", {
        scope,
        runId,
        intentKey: "fork-child",
        machineKey: "child",
        kind: "fork",
        status: "unknown",
        approvalId,
        estimatedUsd: 0.1,
        createdAt: 2,
      }),
    );
  let completed = false;
  const mutations: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      const reply = (value: unknown) => new Response(JSON.stringify(value));
      if (path.endsWith("/me"))
        return reply({ ok: true, user: { id: "synthetic-account" } });
      if (path.endsWith("/limits")) return reply({ ok: true, canStart: false });
      if (init?.method === "DELETE") {
        mutations.push(path);
        return reply({
          ok: true,
          operation: {
            id: path.includes("native-child")
              ? "delete-native-child"
              : "delete-native-parent",
            kind: "sandbox",
            targetId: path.includes("native-child")
              ? "native-child"
              : "native-parent",
            status: "pending",
          },
        });
      }
      if (path.includes("/deletion-operations/"))
        return reply({
          ok: true,
          operation: {
            id: path.includes("native-child")
              ? "delete-native-child"
              : "delete-native-parent",
            kind: "sandbox",
            targetId: path.includes("native-child")
              ? "native-child"
              : "native-parent",
            status: completed ? "completed" : "pending",
          },
        });
      throw Error(`Unexpected native request ${path}`);
    }),
  );
  return {
    t,
    c,
    a,
    b,
    runId,
    scope,
    mutations,
    complete: () => {
      completed = true;
    },
  };
}
test("exact ownership: unrelated machine receives no mutation and pending deletion stays unresolved", async () => {
  const { a, runId, mutations, complete } = await fixture();
  const view = await a.query(status, { runId });
  expect(view.targets.map((t: { key: string }) => t.key)).toEqual(["parent"]);
  const result = await a.action(clean, {
    runId,
    reviewToken: view.reviewToken,
    confirmation: runId,
  });
  expect(result.targets[0].phase).toBe("pending");
  expect(result.complete).toBe(false);
  expect(mutations).toHaveLength(1);
  expect(mutations[0]).toContain("native-parent");
  await a.action(clean, {
    runId,
    reviewToken: result.reviewToken,
    confirmation: runId,
  });
  expect(mutations).toHaveLength(1);
  complete();
  const final = await a.action(inspect, { runId });
  expect(final.complete).toBe(true);
  expect(final.targets[0].phase).toBe("confirmed");
  expect(final.canReset).toBe(false);
});
test("unknown child prevents parent cleanup and reset preserves every recovery record", async () => {
  const { t, a, runId, mutations } = await fixture(true);
  const before = await t.run(async (ctx) => ({
    reservations: await ctx.db.query("liveReservations").collect(),
    approval: await ctx.db.query("liveApprovals").collect(),
  }));
  const view = await a.query(status, { runId });
  expect(view.complete).toBe(false);
  expect(view.canReset).toBe(false);
  await expect(
    a.mutation(reset, {
      runId,
      confirmation: runId,
      reviewToken: view.reviewToken,
    }),
  ).rejects.toThrow();
  await a.action(clean, {
    runId,
    confirmation: runId,
    reviewToken: view.reviewToken,
  });
  expect(mutations).toEqual([]);
  expect(
    await t.run(async (ctx) => ({
      reservations: await ctx.db.query("liveReservations").collect(),
      approval: await ctx.db.query("liveApprovals").collect(),
    })),
  ).toEqual(before);
});
test("foreign scope, wrong run, stale review and wrong confirmation cannot dispatch", async () => {
  const { a, b, runId, mutations } = await fixture();
  const view = await a.query(status, { runId });
  for (const [caller, args] of [
    [b, { runId, confirmation: runId, reviewToken: view.reviewToken }],
    [
      a,
      { runId: "other", confirmation: "other", reviewToken: view.reviewToken },
    ],
    [a, { runId, confirmation: "wrong", reviewToken: view.reviewToken }],
    [a, { runId, confirmation: runId, reviewToken: "stale" }],
  ] as const)
    await expect(caller.action(clean, args)).rejects.toThrow();
  expect(mutations).toEqual([]);
});
test("exact ownership: known child must complete before parent dispatch", async () => {
  const { t, c, a, scope, runId, mutations, complete } = await fixture(true);
  const reservation = await t.run((ctx) =>
    ctx.db
      .query("liveReservations")
      .withIndex("by_scope_and_machineKey_and_kind", (q) =>
        q.eq("scope", scope).eq("machineKey", "child").eq("kind", "fork"),
      )
      .unique(),
  );
  if (!reservation) throw Error("Missing child fixture");
  await t.run((ctx) =>
    ctx.db.insert("liveForks", {
      scope,
      sourceKey: "parent",
      sourceId: "native-parent",
      sourceGeneration: 1,
      childKey: "child",
      operationId: "fork-child",
      stopOperationId: "stop-parent",
      path: "/home/user/.fixture",
      expectedText: "synthetic",
      reservationId: reservation._id,
      childId: "native-child",
      childGeneration: 1,
      copy: "unverified",
    }),
  );
  await t.mutation(c.registry.ensure, {
    sandbox: { scope, key: "child" },
    reference: { provider: "boat", providerId: "native-child" },
  });
  let view = await a.query(status, { runId });
  expect(view.targets.map((target: { key: string }) => target.key)).toEqual([
    "child",
    "parent",
  ]);
  expect(view.targets[1].phase).toBe("unresolved");
  view = await a.action(clean, {
    runId,
    confirmation: runId,
    reviewToken: view.reviewToken,
  });
  expect(mutations).toHaveLength(1);
  expect(mutations[0]).toContain("native-child");
  await a.action(clean, {
    runId,
    confirmation: runId,
    reviewToken: view.reviewToken,
  });
  expect(mutations).toHaveLength(1);
  complete();
  view = await a.action(inspect, { runId });
  expect(view.targets[0].phase).toBe("confirmed");
  expect(view.targets[1].phase).toBe("ready");
  await a.action(clean, {
    runId,
    confirmation: runId,
    reviewToken: view.reviewToken,
  });
  expect(mutations).toHaveLength(2);
  expect(mutations[1]).toContain("native-parent");
});
test("reset enforces retention and archives without erasing ledger or component proof", async () => {
  const { t, c, a, runId, scope, complete } = await fixture();
  let view = await a.query(status, { runId });
  await a.action(clean, {
    runId,
    confirmation: runId,
    reviewToken: view.reviewToken,
  });
  complete();
  view = await a.action(inspect, { runId });
  await expect(
    a.mutation(reset, {
      runId,
      confirmation: runId,
      reviewToken: view.reviewToken,
    }),
  ).rejects.toThrow();
  const before = await t.run(async (ctx) => ({
    reservations: await ctx.db.query("liveReservations").collect(),
    approval: await ctx.db.query("liveApprovals").collect(),
  }));
  const sandbox = { scope, key: "parent" },
    op = await t.query(c.operations.get, { sandbox, operationId: "delete-1" });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(view.resetAfter + 1);
  view = await a.query(status, { runId });
  expect(view.canReset).toBe(true);
  await a.mutation(reset, {
    runId,
    confirmation: runId,
    reviewToken: view.reviewToken,
  });
  expect((await a.query(status, { runId })).archivedAt).not.toBeNull();
  expect(
    await t.run(async (ctx) => ({
      reservations: await ctx.db.query("liveReservations").collect(),
      approval: await ctx.db.query("liveApprovals").collect(),
    })),
  ).toEqual(before);
  expect(
    await t.query(c.operations.get, { sandbox, operationId: "delete-1" }),
  ).toEqual(op);
});
test("stale original binding cannot redirect cleanup to a replacement generation", async () => {
  const { t, c, a, runId, scope, mutations } = await fixture();
  const before = await a.query(status, { runId }),
    sandbox = { scope, key: "parent" };
  const ticket = await t.mutation(c.registry.beginRefresh, { sandbox });
  await t.mutation(c.registry.finishRefresh, {
    sandbox,
    ...ticket,
    result: { state: "deleted" },
  });
  const row = await t.query(c.registry.get, { sandbox });
  if (!row) throw Error("Missing binding");
  await t.mutation(c.registry.rebind, {
    sandbox,
    expectedVersion: row.version,
    reference: { provider: "boat", providerId: "native-parent" },
  });
  await expect(
    a.action(clean, {
      runId,
      confirmation: runId,
      reviewToken: before.reviewToken,
    }),
  ).rejects.toThrow();
  const after = await a.query(status, { runId });
  expect(after.targets[0].phase).toBe("unresolved");
  await a.action(clean, {
    runId,
    confirmation: runId,
    reviewToken: after.reviewToken,
  });
  expect(mutations).toEqual([]);
  expect((await t.query(c.registry.get, { sandbox }))?.generation).toBe(2);
});
