import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { register } from "@fantastic.dev/convex-sandbox/testing";
import { beforeEach, afterEach, test, expect, vi } from "vitest";
import schema from "../schema";
import * as allowance from "./allowance";
import * as commands from "./commands";
const cached = makeFunctionReference<"query">("live/logs:cached"),
  sync = makeFunctionReference<"action">("live/logs:sync"),
  handle = { key: "research-one", operationId: "command-one" };
const issuer = "https://synthetic.clerk.accounts.dev";
let output = "hello\n";
let gap = 0;
let unsupported = false;
let calls: URL[] = [];
beforeEach(() => {
  output = "hello\n";
  gap = 0;
  unsupported = false;
  calls = [];
  vi.stubEnv(
    "EXAMPLE_OPERATOR_GRANTS",
    JSON.stringify(
      ["a", "b"].map((subject) => ({ issuer, subject, scope: subject })),
    ),
  );
  vi.stubEnv("BOAT_API_KEY", "synthetic-log-key");
  vi.stubEnv("BOAT_ORG", "personal");
  vi.stubEnv(
    "EXAMPLE_LIVE_RUN_PLAN",
    JSON.stringify({
      runId: "synthetic-logs",
      scope: "example-boat:a",
      accountId: "account",
      wallet: "personal",
      walletTeamId: null,
      size: "small",
      expiresAt: Date.now() + 3600000,
      maxMachines: 1,
      maxStarts: 1,
      maxConcurrent: 1,
      durationMinutes: 1,
      estimateUsd: 0.1,
      allowanceUsd: 1,
    }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = new URL(String(url));
      expect(init?.method ?? "GET").toBe("GET");
      const reply = (value: unknown) => new Response(JSON.stringify(value));
      if (u.pathname.endsWith("/me"))
        return reply({ ok: true, user: { id: "account" } });
      if (u.pathname.endsWith("/limits"))
        return reply({ ok: true, canStart: true });
      calls.push(u);
      if (unsupported)
        return new Response(
          JSON.stringify({
            error: { code: "agent_outdated", message: "private native error" },
          }),
          { status: 400 },
        );
      const stream = u.searchParams.get("stream"),
        offset =
          Number(u.searchParams.get("offset")) +
          (stream === "stdout" ? gap : 0);
      const bytes = Buffer.from(stream === "stdout" ? output : "");
      const data = bytes.subarray(
        offset,
        offset + Number(u.searchParams.get("limit")),
      );
      return reply({
        ok: true,
        type: "command.logs",
        commandId: "history-one",
        stream,
        offset,
        nextOffset: offset + data.length,
        size: bytes.length,
        encoding: "base64",
        data: data.toString("base64"),
        done: offset + data.length === bytes.length,
      });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function fixture() {
  const logs = await import("./logs");
  const t = convexTest(schema, {
    "./_generated/server.js": () => import("../_generated/server.js"),
    "./live/logs.ts": async () => logs,
    "./live/commands.ts": async () => commands,
    "./live/allowance.ts": async () => allowance,
  });
  const c = register(t),
    a = t.withIdentity({ issuer, subject: "a" }),
    b = t.withIdentity({ issuer, subject: "b" });
  const p = await a.query(
    makeFunctionReference<"query">("live/allowance:proposal"),
    {},
  );
  await a.action(makeFunctionReference<"action">("live/allowance:approve"), {
    reviewToken: p.reviewToken,
    acknowledgeRisk: true,
  });
  const sandbox = { scope: "example-boat:a", key: handle.key };
  const row = await t.mutation(c.registry.ensure, {
    sandbox,
    reference: { provider: "boat", providerId: "native-a" },
  });
  await t.mutation(c.execution.reserve, {
    sandbox,
    operationId: handle.operationId,
    expectedVersion: row.version,
    idempotency: "none",
  });
  const lease = await t.mutation(c.execution.claim, {
    sandbox,
    operationId: handle.operationId,
    mode: "start",
  });
  if (!lease) throw Error("Missing synthetic execution lease");
  await t.mutation(c.execution.publish, {
    sandbox,
    operationId: handle.operationId,
    token: lease.token,
    result: { snapshot: { executionId: "history-one", state: "running" } },
  });
  return { t, c, a, b, sandbox };
}
test("cursor recovery uses retained native offsets across fresh actions and overlapping polling", async () => {
  const { a } = await fixture();
  await Promise.all([a.action(sync, handle), a.action(sync, handle)]);
  const first = await a.query(cached, handle);
  expect(first.entries.map((e: { text: string }) => e.text).join("")).toBe(
    "hello\n",
  );
  expect(
    calls.filter((u) => u.searchParams.get("stream") === "stdout"),
  ).toHaveLength(1);
  calls = [];
  output += "world\n";
  await a.action(sync, handle);
  expect(
    calls
      .find((u) => u.searchParams.get("stream") === "stdout")
      ?.searchParams.get("offset"),
  ).toBe("6");
  const recovered = await a.query(cached, handle);
  expect(recovered.entries.map((e: { text: string }) => e.text).join("")).toBe(
    "hello\nworld\n",
  );
  expect(recovered.nextCursor).toBe(1);
});
test("bounded output and unsupported native offsets are explicit without claiming process completion", async () => {
  const { a } = await fixture();
  output = "x".repeat(100000);
  for (let i = 0; i < 35; i++) await a.action(sync, handle);
  const page = await a.query(cached, handle);
  expect(page.truncated).toBe(true);
  expect(page.entries).toHaveLength(32);
  expect(
    page.entries.reduce(
      (n: number, e: { text: string }) => n + Buffer.byteLength(e.text),
      0,
    ),
  ).toBeLessThanOrEqual(65536);
  expect(
    (await a.query(makeFunctionReference<"query">("live/commands:get"), handle))
      .state,
  ).toBe("running");
});
test("native offset gaps mark truncation and errors preserve the cached output", async () => {
  const { a } = await fixture();
  output = "abcdef";
  gap = 1;
  await a.action(sync, handle);
  const first = await a.query(cached, handle);
  expect(first.truncated).toBe(true);
  unsupported = true;
  gap = 0;
  const result = await a.action(sync, handle);
  expect(result.logErrorCode).toBeDefined();
  expect((await a.query(cached, handle)).entries).toEqual(first.entries);
  expect(JSON.stringify(result)).not.toContain("private native error");
});
test("cached reads make no native requests and foreign or anonymous calls reveal no bytes", async () => {
  const { a, b, t } = await fixture();
  await a.action(sync, handle);
  calls = [];
  await a.query(cached, handle);
  expect(calls).toHaveLength(0);
  expect(await b.query(cached, handle)).toBeNull();
  await expect(b.action(sync, handle)).rejects.toThrow();
  await expect(t.query(cached, handle)).rejects.toThrow();
  expect(calls).toHaveLength(0);
});

test("rebound executions cannot expose cached bytes or fetch native output", async () => {
  const { a, t, c, sandbox } = await fixture();
  await a.action(sync, handle);
  const lease = await t.mutation(c.execution.claim, {
    sandbox,
    operationId: handle.operationId,
    mode: "status",
  });
  if (!lease) throw Error("Missing synthetic status lease");
  await t.mutation(c.execution.publish, {
    sandbox,
    operationId: handle.operationId,
    token: lease.token,
    result: {
      snapshot: { executionId: "history-one", state: "completed", exitCode: 0 },
    },
  });
  const ticket = await t.mutation(c.registry.beginRefresh, { sandbox });
  await t.mutation(c.registry.finishRefresh, {
    sandbox,
    ...ticket,
    result: { state: "deleted" },
  });
  const row = await t.query(c.registry.get, { sandbox });
  if (!row) throw Error("Missing synthetic binding");
  await t.mutation(c.registry.rebind, {
    sandbox,
    expectedVersion: row.version,
    reference: { provider: "boat", providerId: "native-rebound" },
  });
  calls = [];
  expect(await a.query(cached, handle)).toBeNull();
  await expect(a.action(sync, handle)).rejects.toThrow();
  expect(calls).toHaveLength(0);
});

test("drained native output can grow while the original execution stays running", async () => {
  const { a } = await fixture();
  await a.action(sync, handle);
  output += "later\n";
  calls = [];
  await a.action(sync, handle);
  expect(
    calls
      .find((u) => u.searchParams.get("stream") === "stdout")
      ?.searchParams.get("offset"),
  ).toBe("6");
  const page = await a.query(cached, handle);
  expect(page.entries.map((e: { text: string }) => e.text).join("")).toBe(
    "hello\nlater\n",
  );
});
