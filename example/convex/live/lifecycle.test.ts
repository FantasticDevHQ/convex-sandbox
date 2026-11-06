import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { register } from "@fantastic.dev/convex-sandbox/testing";
import { vi, test, expect, beforeEach, afterEach } from "vitest";
import schema from "../schema";
import * as allowance from "./allowance";
const prepare = makeFunctionReference<"action">(
    "live/lifecycle:prepareFixture",
  ),
  run = makeFunctionReference<"action">("live/lifecycle:run"),
  inspect = makeFunctionReference<"action">("live/lifecycle:inspect"),
  status = makeFunctionReference<"query">("live/lifecycle:status");
const proposal = makeFunctionReference<"query">("live/allowance:proposal"),
  approve = makeFunctionReference<"action">("live/allowance:approve");
const issuer = "https://synthetic.clerk.accounts.dev";
let state = {
  machine: "ready",
  stop: "pending",
  bytes: Buffer.alloc(0),
  corrupt: false,
};
let writes: string[] = [];
beforeEach(() => {
  state = {
    machine: "ready",
    stop: "pending",
    bytes: Buffer.alloc(0),
    corrupt: false,
  };
  writes = [];
  vi.stubEnv(
    "EXAMPLE_OPERATOR_GRANTS",
    JSON.stringify(
      ["a", "b"].map((subject) => ({ issuer, subject, scope: subject })),
    ),
  );
  vi.stubEnv("BOAT_API_KEY", "synthetic-lifecycle-key");
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
      const url = new URL(String(input));
      const path = url.pathname;
      const method = init?.method ?? "GET";
      if (method !== "GET") writes.push(path);
      const reply = (value: unknown) => new Response(JSON.stringify(value));
      if (path.endsWith("/me"))
        return reply({ ok: true, user: { id: "synthetic-account" } });
      if (path.endsWith("/limits")) return reply({ ok: true, canStart: true });
      if (path.includes("/files")) {
        const file =
          method === "PUT"
            ? JSON.parse(String(init?.body)).path
            : url.searchParams.get("path");
        if (method === "PUT") {
          state.bytes = Buffer.from(
            JSON.parse(String(init?.body)).content,
            "base64",
          );
          return reply({
            ok: true,
            success: true,
            path: file,
            encoding: "base64",
            size: state.bytes.length,
          });
        }
        const data = state.corrupt ? Buffer.from("changed") : state.bytes;
        return reply({
          ok: true,
          success: true,
          path: file,
          encoding: "base64",
          size: data.length,
          content: data.toString("base64"),
        });
      }
      if (path.endsWith("/stop")) {
        state.machine = "archiving";
        return reply({
          ok: true,
          id: "native-a",
          stop: { id: "stop-one", status: "pending" },
        });
      }
      if (path.includes("/stops/"))
        return reply({
          ok: true,
          id: "native-a",
          stop: { id: "stop-one", status: state.stop },
        });
      if (path.endsWith("/resume")) {
        state.machine = "provisioning";
        return reply({ ok: true, id: "native-a" });
      }
      return reply({
        ok: true,
        sandbox: { id: "native-a", state: state.machine },
      });
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
async function fixture() {
  const functions = await import("./lifecycle");
  const t = convexTest(schema, {
    "./_generated/server.js": () => import("../_generated/server.js"),
    "./live/lifecycle.ts": async () => functions,
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
  const sandbox = { scope: "example-boat:a", key: "research-one" };
  await a.mutation(
    makeFunctionReference<"mutation">("live/allowance:reserve"),
    {
      runId: "synthetic-run",
      intentKey: "create-research-one",
      machineKey: "research-one",
      kind: "create",
    },
  );
  const claim = await t.mutation(c.lifecycle.reserveCreate, {
    sandbox,
    provider: "boat",
    operationId: "create-research-one",
    idempotency: "native",
  });
  if (claim.kind !== "provision") throw Error("Missing synthetic claim");
  await t.mutation(c.lifecycle.finishCreate, {
    sandbox,
    operationId: "create-research-one",
    expectedVersion: claim.provision.version,
    result: { description: { providerId: "native-a", state: "running" } },
  });
  const ticket = await t.mutation(c.registry.beginRefresh, {
    sandbox: { scope: "example-boat:a", key: "research-one" },
  });
  await t.mutation(c.registry.finishRefresh, {
    sandbox: { scope: "example-boat:a", key: "research-one" },
    ...ticket,
    result: { state: "running" },
  });
  return { t, c, a, b };
}
test("foreign binding rejects before native mutation", async () => {
  const { b } = await fixture();
  await expect(
    b.action(run, { key: "research-one", action: "stop", operationId: "one" }),
  ).rejects.toThrow();
  expect(writes).toHaveLength(0);
});
test("accepted stop retains an unfinished native job", async () => {
  const { a } = await fixture();
  await a.action(run, {
    key: "research-one",
    action: "stop",
    operationId: "one",
  });
  const v = await a.query(status, { key: "research-one" });
  expect(v.row.observedState).toBe("stopping");
  expect(v.operation.status).not.toBe("succeeded");
  expect(v.operation.nativeLifecycle.id).toBe("stop-one");
});
test("resume waits for readiness then compares original home bytes", async () => {
  const { a } = await fixture();
  await a.action(prepare, { key: "research-one" });
  const original = Buffer.from(state.bytes);
  expect(original.length).toBeGreaterThan(0);
  await a.action(run, {
    key: "research-one",
    action: "stop",
    operationId: "one",
  });
  state.stop = "completed";
  state.machine = "archived";
  await a.action(inspect, { key: "research-one" });
  await a.action(run, {
    key: "research-one",
    action: "start",
    operationId: "two",
  });
  expect(
    (await a.query(status, { key: "research-one" })).fixture.status,
  ).not.toBe("verified");
  state.machine = "ready";
  await a.action(inspect, { key: "research-one" });
  expect(state.bytes).toEqual(original);
  expect((await a.query(status, { key: "research-one" })).fixture.status).toBe(
    "verified",
  );
});
test("mismatched bytes never claim persistence", async () => {
  const { a } = await fixture();
  await a.action(prepare, { key: "research-one" });
  await a.action(run, {
    key: "research-one",
    action: "stop",
    operationId: "one",
  });
  state.stop = "completed";
  state.machine = "archived";
  await a.action(inspect, { key: "research-one" });
  await a.action(run, {
    key: "research-one",
    action: "start",
    operationId: "two",
  });
  state.machine = "ready";
  state.corrupt = true;
  await a.action(inspect, { key: "research-one" });
  expect((await a.query(status, { key: "research-one" })).fixture.status).toBe(
    "mismatch",
  );
});

test("only an exact completed stop releases concurrency, never cumulative allowance", async () => {
  const { a } = await fixture();
  const release = makeFunctionReference<"mutation">(
    "live/allowance:releaseStopped",
  );
  await expect(
    a.mutation(release, { key: "research-one", operationId: "missing" }),
  ).rejects.toThrow();
  await a.action(run, {
    key: "research-one",
    action: "stop",
    operationId: "one",
  });
  await expect(
    a.mutation(release, { key: "research-one", operationId: "stop-one" }),
  ).rejects.toThrow();
  state.stop = "completed";
  state.machine = "archived";
  await a.action(inspect, { key: "research-one" });
  const ledger = (await a.query(proposal, {})).approval;
  expect(ledger.activeReservations).toBe(0);
  expect(ledger.machinesReserved).toBe(1);
  expect(ledger.startsReserved).toBe(1);
  expect(ledger.estimatedUsdReserved).toBe(0.1);
  await a.mutation(release, { key: "research-one", operationId: "stop-one" });
  expect((await a.query(proposal, {})).approval.activeReservations).toBe(0);
});
test("an unresolved creation with no confirmed child remains counted when another machine stops", async () => {
  const p = JSON.parse(process.env.EXAMPLE_LIVE_RUN_PLAN ?? "{}");
  vi.stubEnv(
    "EXAMPLE_LIVE_RUN_PLAN",
    JSON.stringify({ ...p, maxMachines: 2, maxStarts: 3, maxConcurrent: 2 }),
  );
  const { a } = await fixture();
  const r = await a.mutation(
    makeFunctionReference<"mutation">("live/allowance:reserve"),
    {
      runId: "synthetic-run",
      intentKey: "create-orphan",
      machineKey: "orphan",
      kind: "create",
    },
  );
  await a.mutation(
    makeFunctionReference<"mutation">("live/allowance:markUnknown"),
    { reservationId: r.reservationId },
  );
  const before = (await a.query(proposal, {})).approval;
  await a.action(run, {
    key: "research-one",
    action: "stop",
    operationId: "one",
  });
  state.stop = "completed";
  state.machine = "archived";
  await a.action(inspect, { key: "research-one" });
  const after = (await a.query(proposal, {})).approval;
  expect(after.activeReservations).toBe(1);
  expect(after.machinesReserved).toBe(before.machinesReserved);
  expect(after.startsReserved).toBe(before.startsReserved);
  expect(after.estimatedUsdReserved).toBe(before.estimatedUsdReserved);
});

test("an interrupted resume admission stays visible and refuses a replacement intent", async () => {
  const { a } = await fixture();
  await a.action(prepare, { key: "research-one" });
  await a.action(run, {
    key: "research-one",
    action: "stop",
    operationId: "one",
  });
  state.stop = "completed";
  state.machine = "archived";
  await a.action(inspect, { key: "research-one" });
  await a.mutation(
    makeFunctionReference<"mutation">("live/allowance:reserve"),
    {
      runId: "synthetic-run",
      intentKey: "start-orphan",
      machineKey: "research-one",
      kind: "start",
    },
  );
  expect(
    (await a.query(status, { key: "research-one" })).unresolvedStartIntent,
  ).toBe("start-orphan");
  await a.action(run, {
    key: "research-one",
    action: "start",
    operationId: "replacement",
  });
  expect(writes.filter((path) => path.endsWith("/resume"))).toHaveLength(0);
  expect((await a.query(proposal, {})).approval.activeReservations).toBe(1);
});

test("concurrent distinct resumes reserve one machine intent and preserve the winning fixture link", async () => {
  const p = JSON.parse(process.env.EXAMPLE_LIVE_RUN_PLAN ?? "{}");
  vi.stubEnv(
    "EXAMPLE_LIVE_RUN_PLAN",
    JSON.stringify({ ...p, maxMachines: 2, maxStarts: 3, maxConcurrent: 2 }),
  );
  const { a } = await fixture();
  await a.action(prepare, { key: "research-one" });
  await a.action(run, {
    key: "research-one",
    action: "stop",
    operationId: "one",
  });
  state.stop = "completed";
  state.machine = "archived";
  await a.action(inspect, { key: "research-one" });
  await Promise.allSettled(
    ["two", "three"].map((operationId) =>
      a.action(run, { key: "research-one", action: "start", operationId }),
    ),
  );
  expect(writes.filter((path) => path.endsWith("/resume"))).toHaveLength(1);
  const pending = await a.query(status, { key: "research-one" });
  expect(pending.fixture.resumeOperationId).toBe(pending.row.activeOperationId);
  expect((await a.query(proposal, {})).approval.activeReservations).toBe(1);
  expect((await a.query(proposal, {})).approval.startsReserved).toBe(2);
  state.machine = "ready";
  await a.action(inspect, { key: "research-one" });
  expect((await a.query(status, { key: "research-one" })).fixture.status).toBe(
    "verified",
  );
});
