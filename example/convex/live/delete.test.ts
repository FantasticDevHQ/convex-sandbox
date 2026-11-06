import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { register } from "@fantastic.dev/convex-sandbox/testing";
import { vi, test, expect, beforeEach, afterEach } from "vitest";
import schema from "../schema";
import * as allowance from "./allowance";
const view = makeFunctionReference<"query">("live/delete:status"),
  remove = makeFunctionReference<"action">("live/delete:request"),
  inspect = makeFunctionReference<"action">("live/delete:inspect");
const proposal = makeFunctionReference<"query">("live/allowance:proposal"),
  approve = makeFunctionReference<"action">("live/allowance:approve");
const issuer = "https://synthetic.clerk.accounts.dev";
let job = {
  id: "synthetic-delete-job",
  kind: "sandbox",
  targetId: "native-a",
  status: "pending",
};
let missing = false;
let deletes = 0;
beforeEach(() => {
  job = {
    id: "synthetic-delete-job",
    kind: "sandbox",
    targetId: "native-a",
    status: "pending",
  };
  missing = false;
  deletes = 0;
  vi.stubEnv(
    "EXAMPLE_OPERATOR_GRANTS",
    JSON.stringify(
      ["a", "b"].map((subject) => ({ issuer, subject, scope: subject })),
    ),
  );
  vi.stubEnv("BOAT_API_KEY", "synthetic-delete-key");
  vi.stubEnv("BOAT_ORG", "personal");
  vi.stubEnv(
    "EXAMPLE_LIVE_RUN_PLAN",
    JSON.stringify({
      runId: "synthetic-run",
      scope: "example-boat:a",
      accountId: "synthetic-account",
      wallet: "personal",
      walletTeamId: null,
      size: "small",
      expiresAt: Date.now() + 600_000,
      maxMachines: 1,
      maxStarts: 2,
      maxConcurrent: 1,
      durationMinutes: 10,
      estimateUsd: 0.2,
      allowanceUsd: 1,
    }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      const reply = (value: unknown, status = 200) =>
        new Response(JSON.stringify(value), { status });
      if (path.endsWith("/me"))
        return reply({ ok: true, user: { id: "synthetic-account" } });
      if (path.endsWith("/limits")) return reply({ ok: true, canStart: true });
      if (init?.method === "DELETE") {
        deletes++;
        expect(new Headers(init.headers).get("X-ASCII-Confirm-Delete")).toBe(
          "native-a",
        );
        return reply({ ok: true, operation: job }, 202);
      }
      if (path.includes("/deletion-operations/"))
        return missing
          ? reply({ error: "synthetic missing" }, 404)
          : reply({ ok: true, operation: job });
      return reply({ ok: true, sandbox: { id: "native-a", state: "ready" } });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function fixture() {
  const functions = await import("./delete");
  const t = convexTest(schema, {
    "./_generated/server.js": () => import("../_generated/server.js"),
    "./live/delete.ts": async () => functions,
    "./live/allowance.ts": async () => allowance,
  });
  const c = register(t);
  const a = t.withIdentity({ issuer, subject: "a" }),
    b = t.withIdentity({ issuer, subject: "b" });
  const p = await a.query(proposal, {});
  await a.action(approve, {
    reviewToken: p.reviewToken,
    acknowledgeRisk: true,
  });
  await t.mutation(c.registry.ensure, {
    sandbox: { scope: "example-boat:a", key: "research-one" },
    reference: { provider: "boat", providerId: "native-a" },
  });
  return { t, c, a, b };
}
async function request(a: Awaited<ReturnType<typeof fixture>>["a"]) {
  const v = await a.query(view, { key: "research-one" });
  return a.action(remove, {
    key: "research-one",
    confirmation: "research-one",
    reviewToken: v.reviewToken,
  });
}
test("accepted deletion remains pending and duplicate requests never replay", async () => {
  const { a } = await fixture();
  await Promise.all([request(a), request(a)]);
  expect(deletes).toBe(1);
  expect((await a.query(view, { key: "research-one" })).phase).toBe("pending");
});
test("matching completed job confirms deletion and preserves tombstone", async () => {
  const { a } = await fixture();
  await request(a);
  job.status = "completed";
  await a.action(inspect, { key: "research-one" });
  const v = await a.query(view, { key: "research-one" });
  expect(v.phase).toBe("confirmed");
  expect(v.row.tombstone).toBe(true);
  await a.action(inspect, { key: "research-one" });
  expect(deletes).toBe(1);
});
test("wrong target keeps cleanup unresolved", async () => {
  const { a } = await fixture();
  await request(a);
  job.status = "completed";
  job.targetId = "foreign-native";
  await a.action(inspect, { key: "research-one" });
  const v = await a.query(view, { key: "research-one" });
  expect(v.phase).toBe("unresolved");
  expect(v.row.tombstone).toBe(false);
  expect(v.operation.nativeLifecycle.id).toBe("synthetic-delete-job");
});
test("404 and accepted completed DELETE are not independent completion proof", async () => {
  const { a } = await fixture();
  job.status = "completed";
  await request(a);
  expect((await a.query(view, { key: "research-one" })).phase).toBe("pending");
  missing = true;
  await a.action(inspect, { key: "research-one" });
  expect((await a.query(view, { key: "research-one" })).phase).toBe(
    "unresolved",
  );
});
test("foreign, anonymous, wrong confirmation and stale target review cannot delete", async () => {
  const { t, a, b } = await fixture();
  const v = await a.query(view, { key: "research-one" });
  for (const caller of [t, b])
    await expect(
      caller.action(remove, {
        key: "research-one",
        confirmation: "research-one",
        reviewToken: v.reviewToken,
      }),
    ).rejects.toThrow();
  await expect(
    a.action(remove, {
      key: "research-one",
      confirmation: "wrong",
      reviewToken: v.reviewToken,
    }),
  ).rejects.toThrow();
  await expect(
    a.action(remove, {
      key: "research-one",
      confirmation: "research-one",
      reviewToken: "stale",
    }),
  ).rejects.toThrow();
  expect(deletes).toBe(0);
});

test("cleanup uses retained account approval after a malformed proposal and never resets journals", async () => {
  const { a } = await fixture();
  vi.stubEnv("EXAMPLE_LIVE_RUN_PLAN", "invalid-json");
  await request(a);
  job.status = "completed";
  await a.action(inspect, { key: "research-one" });
  expect((await a.query(view, { key: "research-one" })).phase).toBe(
    "confirmed",
  );
  expect(deletes).toBe(1);
});

test("a stale reviewed binding cannot redirect deletion to a replacement", async () => {
  const { t, c, a } = await fixture();
  const original = await a.query(view, { key: "research-one" });
  const sandbox = { scope: "example-boat:a", key: "research-one" };
  const ticket = await t.mutation(c.registry.beginRefresh, { sandbox });
  await t.mutation(c.registry.finishRefresh, {
    sandbox,
    ...ticket,
    result: { state: "deleted" },
  });
  const row = await t.query(c.registry.get, { sandbox });
  if (!row) throw Error("Missing fixture binding");
  await t.mutation(c.registry.rebind, {
    sandbox,
    expectedVersion: row.version,
    reference: { provider: "boat", providerId: "native-replacement" },
  });
  await expect(
    a.action(remove, {
      key: "research-one",
      confirmation: "research-one",
      reviewToken: original.reviewToken,
    }),
  ).rejects.toThrow();
  expect(deletes).toBe(0);
});
