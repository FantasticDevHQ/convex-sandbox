import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { register } from "@fantastic.dev/convex-sandbox/testing";
import { test, expect, vi, afterEach } from "vitest";
import schema from "../schema";
const list = makeFunctionReference<"query">("live/recovery:list"),
  inspect = makeFunctionReference<"action">("live/recovery:inspect"),
  context = makeFunctionReference<"query">("live/recovery:context");
const issuer = "https://synthetic.clerk.accounts.dev";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
async function fixture() {
  vi.stubEnv(
    "EXAMPLE_OPERATOR_GRANTS",
    JSON.stringify([
      { issuer, subject: "a", scope: "a" },
      { issuer, subject: "b", scope: "b" },
    ]),
  );
  const recovery = await import("./recovery");
  const allowance = await import("./allowance");
  const t = convexTest(schema, {
    "./_generated/server.js": () => import("../_generated/server.js"),
    "./live/recovery.ts": async () => recovery,
    "./live/allowance.ts": async () => allowance,
  });
  const c = register(t),
    a = t.withIdentity({ issuer, subject: "a" }),
    b = t.withIdentity({ issuer, subject: "b" });
  const sandbox = { scope: "example-boat:a", key: "research-one" };
  const row = await t.mutation(c.registry.ensure, {
    sandbox,
    reference: { provider: "boat", providerId: "original" },
  });
  const op = await t.mutation(c.operations.begin, {
    sandbox,
    expectedVersion: row.version,
    operationId: "stop-original",
    kind: "stop",
  });
  return { t, c, a, b, sandbox, op };
}
test("no replay: reopening unknown work is cached and dispatches no native request", async () => {
  const { t, c, a, b, sandbox, op } = await fixture();
  await t.mutation(c.operations.transition, {
    sandbox,
    operationId: op.operationId,
    expectedVersion: op.version,
    status: "unknown",
  });
  const fetch = vi.fn(() => {
    throw Error("unexpected network");
  });
  vi.stubGlobal("fetch", fetch);
  const args = {
    key: sandbox.key,
    paginationOpts: { cursor: null, numItems: 20 },
  };
  for (let i = 0; i < 2; i++) {
    const page = await a.query(list, args);
    expect(page.page[0]).toMatchObject({
      operationId: op.operationId,
      status: "unknown",
    });
    await a.query(context, { key: sandbox.key });
  }
  expect((await b.query(list, args)).page).toEqual([]);
  await expect(t.query(list, args)).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
test("stale generation is retained as history and cannot be inspected", async () => {
  const { t, c, a, sandbox, op } = await fixture();
  await t.mutation(c.operations.transition, {
    sandbox,
    operationId: op.operationId,
    expectedVersion: op.version,
    status: "succeeded",
  });
  const refresh = await t.mutation(c.registry.beginRefresh, { sandbox });
  await t.mutation(c.registry.finishRefresh, {
    sandbox,
    ...refresh,
    result: { state: "deleted" },
  });
  const row = await t.query(c.registry.get, { sandbox });
  await t.mutation(c.registry.rebind, {
    sandbox,
    expectedVersion: row?.version ?? -1,
    reference: { provider: "boat", providerId: "replacement" },
  });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect(
    (
      await a.query(list, {
        key: sandbox.key,
        paginationOpts: { cursor: null, numItems: 20 },
      })
    ).page[0].reference.providerId,
  ).toBe("original");
  await expect(
    a.action(inspect, {
      key: sandbox.key,
      operationId: op.operationId,
      generation: 1,
      providerId: "original",
    }),
  ).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  expect(
    (await t.query(c.registry.get, { sandbox }))?.reference.providerId,
  ).toBe("replacement");
});
test("bounded native inspection uses reads only and fences a late old-generation reply", async () => {
  const { t, c, a, sandbox, op } = await fixture();
  await t.mutation(c.operations.transition, {
    sandbox,
    operationId: op.operationId,
    expectedVersion: 1,
    status: "unknown",
  });
  vi.stubEnv("BOAT_API_KEY", "synthetic-recovery-key");
  vi.stubEnv("BOAT_ORG", "personal");
  await t.run(async (ctx) => {
    await ctx.db.insert("liveApprovals", {
      scope: sandbox.scope,
      plan: {
        runId: "synthetic-run",
        scope: sandbox.scope,
        accountId: "synthetic-account",
        wallet: "personal",
        walletTeamId: null,
        size: "small",
        expiresAt: 1,
        maxMachines: 1,
        maxStarts: 1,
        maxConcurrent: 1,
        durationMinutes: 1,
        estimateUsd: 0.1,
        allowanceUsd: 1,
      },
      reviewToken: "synthetic",
      approvedAt: 1,
      approvedBy: { issuer, subject: "a" },
      machinesReserved: 1,
      startsReserved: 0,
      activeReservations: 1,
      estimatedUsdReserved: 0.1,
    });
  });
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      expect(init?.method ?? "GET").toBe("GET");
      const path = new URL(String(url)).pathname;
      calls.push(path);
      const reply = (body: unknown) => new Response(JSON.stringify(body));
      if (path.endsWith("/me"))
        return reply({ ok: true, user: { id: "synthetic-account" } });
      if (path.endsWith("/limits")) return reply({ ok: true, canStart: false });
      await t.mutation(c.operations.transition, {
        sandbox,
        operationId: op.operationId,
        expectedVersion: 3,
        status: "succeeded",
      });
      const refresh = await t.mutation(c.registry.beginRefresh, { sandbox });
      await t.mutation(c.registry.finishRefresh, {
        sandbox,
        ...refresh,
        result: { state: "deleted" },
      });
      const row = await t.query(c.registry.get, { sandbox });
      await t.mutation(c.registry.rebind, {
        sandbox,
        expectedVersion: row?.version ?? -1,
        reference: { provider: "boat", providerId: "replacement" },
      });
      return reply({
        ok: true,
        sandbox: { id: "original", state: "archived" },
      });
    }),
  );
  await a.action(inspect, {
    key: sandbox.key,
    operationId: op.operationId,
    generation: 1,
    providerId: "original",
  });
  expect(
    calls.filter((path) => !path.endsWith("/me") && !path.endsWith("/limits")),
  ).toHaveLength(1);
  const current = await t.query(c.registry.get, { sandbox });
  expect(current).toMatchObject({
    generation: 2,
    reference: { providerId: "replacement" },
    observedState: "unknown",
  });
});
test("foreign and anonymous inspection cannot reach provider; pagination is bounded", async () => {
  const { a, b, t, sandbox, op } = await fixture();
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  for (const caller of [b, t])
    await expect(
      caller.action(inspect, {
        key: sandbox.key,
        operationId: op.operationId,
        generation: 1,
        providerId: "original",
      }),
    ).rejects.toThrow();
  for (const n of [0, 51])
    await expect(
      a.query(list, {
        key: sandbox.key,
        paginationOpts: { cursor: null, numItems: n },
      }),
    ).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
