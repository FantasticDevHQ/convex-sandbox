import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { register } from "@fantastic.dev/convex-sandbox/testing";
import { vi, test, expect, beforeEach, afterEach } from "vitest";
import schema from "../schema";
import * as allowance from "./allowance";
const start = makeFunctionReference<"action">("live/commands:start"),
  get = makeFunctionReference<"query">("live/commands:get"),
  inspect = makeFunctionReference<"action">("live/commands:inspect"),
  list = makeFunctionReference<"query">("live/commands:list");
const proposal = makeFunctionReference<"query">("live/allowance:proposal"),
  approve = makeFunctionReference<"action">("live/allowance:approve");
const issuer = "https://synthetic.clerk.accounts.dev";
const args = {
  key: "research-one",
  operationId: "command-one",
  input: {
    kind: "argv" as const,
    executable: "/usr/bin/printf",
    args: ["%s\n", "hello sandbox"],
  },
};
let count = 0;
let lost = false;
let exited = false;
beforeEach(() => {
  count = 0;
  lost = false;
  exited = false;
  vi.stubEnv(
    "EXAMPLE_OPERATOR_GRANTS",
    JSON.stringify(
      ["a", "b"].map((subject) => ({ issuer, subject, scope: subject })),
    ),
  );
  vi.stubEnv("BOAT_API_KEY", "synthetic-command-key");
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
      expiresAt: Date.now() + 3_600_000,
      maxMachines: 1,
      maxStarts: 2,
      maxConcurrent: 1,
      durationMinutes: 1,
      estimateUsd: 0.2,
      allowanceUsd: 1,
    }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      const reply = (value: unknown) => new Response(JSON.stringify(value));
      if (path.endsWith("/me"))
        return reply({ ok: true, user: { id: "synthetic-account" } });
      if (path.endsWith("/limits")) return reply({ ok: true, canStart: true });
      if (init?.method === "POST") {
        count++;
        expect(JSON.parse(String(init.body))).toMatchObject({
          detached: true,
          stream: false,
        });
        if (lost) throw Error("synthetic lost reply");
        return reply({
          ok: true,
          success: true,
          type: "command.started",
          commandId: "synthetic-history-id",
          pid: 123,
          processId: 123,
          command: "synthetic-private-command",
        });
      }
      return reply({
        ok: true,
        command: {
          commandId: "synthetic-history-id",
          sandboxId: "native-a",
          mode: "detached",
          status: exited ? "exited" : "running",
          exitCode: exited ? 17 : null,
          stdout: "synthetic-private-output",
        },
      });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
async function fixture() {
  const functions = await import("./commands");
  const t = convexTest(schema, {
    "./_generated/server.js": () => import("../_generated/server.js"),
    "./live/commands.ts": async () => functions,
    "./live/allowance.ts": async () => allowance,
  });
  const c = register(t),
    a = t.withIdentity({ issuer, subject: "a" }),
    b = t.withIdentity({ issuer, subject: "b" });
  const p = await a.query(proposal, {});
  await a.action(approve, {
    reviewToken: p.reviewToken,
    acknowledgeRisk: true,
  });
  const sandbox = { scope: "example-boat:a", key: "research-one" };
  await t.mutation(c.registry.ensure, {
    sandbox,
    reference: { provider: "boat", providerId: "native-a" },
  });
  const ticket = await t.mutation(c.registry.beginRefresh, { sandbox });
  await t.mutation(c.registry.finishRefresh, {
    sandbox,
    ...ticket,
    result: { state: "running" },
  });
  return { t, c, a, b };
}
test("accepted command retains history identity across query reload and duplicate start", async () => {
  const { a } = await fixture();
  await Promise.all([a.action(start, args), a.action(start, args)]);
  const record = await a.query(get, {
    key: args.key,
    operationId: args.operationId,
  });
  expect(record.executionId).toBe("synthetic-history-id");
  expect(record.state).toBe("running");
  expect(count).toBe(1);
  expect(JSON.stringify(record)).not.toMatch(/synthetic-private|processId|pid/);
  expect(
    (
      await a.query(list, {
        key: args.key,
        paginationOpts: { cursor: null, numItems: 20 },
      })
    ).page[0].operationId,
  ).toBe(args.operationId);
});
test("native history completion preserves the exact exit code", async () => {
  const { a } = await fixture();
  await a.action(start, args);
  exited = true;
  await a.action(inspect, { key: args.key, operationId: args.operationId });
  const record = await a.query(get, {
    key: args.key,
    operationId: args.operationId,
  });
  expect(record.state).toBe("completed");
  expect(record.exitCode).toBe(17);
  expect(count).toBe(1);
});
test("unknown start remains unknown and reconciliation never dispatches a second command", async () => {
  const { a } = await fixture();
  lost = true;
  await a.action(start, args);
  expect(
    (await a.query(get, { key: args.key, operationId: args.operationId }))
      .state,
  ).toBe("unknown");
  await a.action(inspect, { key: args.key, operationId: args.operationId });
  await a.action(start, args);
  expect(count).toBe(1);
  expect(
    (await a.query(get, { key: args.key, operationId: args.operationId }))
      .executionId,
  ).toBeUndefined();
});
test("foreign, anonymous and unsupported inputs cannot start a command", async () => {
  const { t, a, b } = await fixture();
  for (const caller of [t, b])
    await expect(caller.action(start, args)).rejects.toThrow();
  await expect(
    a.action(start, { ...args, input: { ...args.input, timeoutMs: 500 } }),
  ).rejects.toThrow();
  await expect(
    a.action(start, {
      ...args,
      input: { ...args.input, env: { SECRET: "no" } },
    }),
  ).rejects.toThrow();
  expect(count).toBe(0);
  expect(
    await b.query(get, { key: args.key, operationId: args.operationId }),
  ).toBeNull();
});
test("run duration closes new command admission before absolute expiry", async () => {
  const { a } = await fixture();
  const plan = (await a.query(proposal, {})).approval;
  vi.useFakeTimers();
  vi.setSystemTime(plan.approvedAt + 61_000);
  await expect(a.action(start, args)).rejects.toThrow(/duration/i);
  expect(count).toBe(0);
});
