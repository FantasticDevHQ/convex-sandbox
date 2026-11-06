import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "../schema";
import * as functions from "./allowance";
const proposal = makeFunctionReference<"query">("live/allowance:proposal");
const approve = makeFunctionReference<"action">("live/allowance:approve");
const reserve = makeFunctionReference<"mutation">("live/allowance:reserve");
const unknown = makeFunctionReference<"mutation">("live/allowance:markUnknown");
const issuer = "https://synthetic.clerk.accounts.dev";
const plan = () => ({
  runId: "synthetic-reviewed-run",
  scope: "example-boat:a",
  accountId: "synthetic-account",
  wallet: "personal",
  walletTeamId: null,
  size: "small",
  expiresAt: Date.now() + 60_000,
  maxMachines: 2,
  maxStarts: 2,
  maxConcurrent: 1,
  durationMinutes: 10,
  estimateUsd: 0.2,
  allowanceUsd: 1,
});
let reviewed: ReturnType<typeof plan>;
beforeEach(() => {
  reviewed = plan();
  vi.stubEnv("EXAMPLE_LIVE_RUN_PLAN", JSON.stringify(reviewed));
  vi.stubEnv(
    "EXAMPLE_OPERATOR_GRANTS",
    JSON.stringify(
      ["a", "b"].map((subject) => ({ issuer, subject, scope: subject })),
    ),
  );
  vi.stubEnv("BOAT_API_KEY", "synthetic-key");
  vi.stubEnv("BOAT_ORG", "personal");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string | URL | Request) =>
        new Response(
          JSON.stringify(
            String(url).endsWith("/me")
              ? { ok: true, user: { id: "synthetic-account" } }
              : { ok: true, limits: { canStart: true } },
          ),
        ),
    ),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function fixture() {
  const t = convexTest(schema, {
    "./_generated/server.js": () => import("../_generated/server.js"),
    "./live/allowance.ts": async () => functions,
  });
  return {
    t,
    a: t.withIdentity({ issuer, subject: "a" }),
    b: t.withIdentity({ issuer, subject: "b" }),
  };
}
async function approved() {
  const f = fixture();
  const p = await f.a.query(proposal, {});
  await f.a.action(approve, {
    reviewToken: p.reviewToken,
    acknowledgeRisk: true,
  });
  return f;
}
test("expired approval refuses admission before native mutation", async () => {
  const { a } = await approved();
  vi.useFakeTimers();
  vi.setSystemTime(reviewed.expiresAt + 1);
  const native = vi.fn();
  await expect(
    a.run(async (ctx) => {
      const r = await ctx.runMutation(reserve, {
        runId: reviewed.runId,
        intentKey: "one",
        kind: "create",
        machineKey: "one",
      });
      if (r.admitted) native();
    }),
  ).rejects.toThrow(/expired/i);
  expect(native).not.toHaveBeenCalled();
});
test("concurrent limit atomically admits one remaining slot", async () => {
  const { a } = await approved();
  const results = await Promise.allSettled(
    ["one", "two"].map((intentKey) =>
      a.mutation(reserve, {
        runId: reviewed.runId,
        intentKey,
        kind: "create",
        machineKey: intentKey,
      }),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  expect((await a.query(proposal, {})).approval.activeReservations).toBe(1);
});
test("unknown reservation remains counted across reload and expiry", async () => {
  const { a } = await approved();
  const r = await a.mutation(reserve, {
    runId: reviewed.runId,
    intentKey: "lost-reply",
    kind: "create",
    machineKey: "one",
  });
  await a.mutation(unknown, { reservationId: r.reservationId });
  const reloaded = await a.query(proposal, {});
  expect(reloaded.approval.activeReservations).toBe(1);
  expect(reloaded.approval.machinesReserved).toBe(1);
  const retry = await a.mutation(reserve, {
    runId: reviewed.runId,
    intentKey: "lost-reply",
    kind: "create",
    machineKey: "one",
  });
  expect(retry.admitted).toBe(false);
  expect(retry.status).toBe("unknown");
  vi.useFakeTimers();
  vi.setSystemTime(reviewed.expiresAt + 1);
  expect((await a.query(proposal, {})).approval.activeReservations).toBe(1);
});
test("missing approval, other operators, changed plans and forged account cannot authorize", async () => {
  const { t, a, b } = fixture();
  await expect(
    a.mutation(reserve, {
      runId: reviewed.runId,
      intentKey: "one",
      kind: "create",
      machineKey: "one",
    }),
  ).rejects.toThrow(/approval/i);
  await expect(t.query(proposal, {})).rejects.toThrow(/authentication/i);
  expect((await b.query(proposal, {})).plan).toBeNull();
  const p = await a.query(proposal, {});
  vi.stubEnv(
    "EXAMPLE_LIVE_RUN_PLAN",
    JSON.stringify({ ...reviewed, allowanceUsd: 2 }),
  );
  await expect(
    a.action(approve, { reviewToken: p.reviewToken, acknowledgeRisk: true }),
  ).rejects.toThrow(/changed/i);
  vi.stubEnv(
    "EXAMPLE_LIVE_RUN_PLAN",
    JSON.stringify({ ...reviewed, accountId: "wrong" }),
  );
  const changed = await a.query(proposal, {});
  await expect(
    a.action(approve, {
      reviewToken: changed.reviewToken,
      acknowledgeRisk: true,
    }),
  ).rejects.toThrow(/account/i);
  expect((await a.query(proposal, {})).approval).toBeNull();
});
test("repeated approval and retries cannot reset or duplicate the durable ledger", async () => {
  const { a } = await approved();
  const p = await a.query(proposal, {});
  const args = {
    runId: reviewed.runId,
    intentKey: "one",
    kind: "create",
    machineKey: "one",
  };
  await a.mutation(reserve, args);
  await a.action(approve, {
    reviewToken: p.reviewToken,
    acknowledgeRisk: true,
  });
  expect((await a.query(proposal, {})).approval.activeReservations).toBe(1);
  expect((await a.mutation(reserve, args)).admitted).toBe(false);
  await expect(
    a.mutation(reserve, { ...args, machineKey: "different" }),
  ).rejects.toThrow(/intent/i);
});
