import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { register } from "@fantastic.dev/convex-sandbox/testing";
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import schema from "../schema";
import * as allowance from "./allowance";
import * as lifecycle from "./lifecycle";
const action = (module: string, name: string) =>
  makeFunctionReference<"action">(`live/${module}:${name}`);
const status = makeFunctionReference<"query">("live/fork:status");
const args = { sourceKey: "research-one", childKey: "research-child" };
const issuer = "https://synthetic.clerk.accounts.dev";
let forkCount = 0,
  lost = false,
  corrupt = false,
  ready = false,
  childStopped = false,
  stop = "pending",
  bytes = Buffer.alloc(0);
beforeEach(() => {
  forkCount = 0;
  lost = false;
  corrupt = false;
  ready = false;
  childStopped = false;
  stop = "pending";
  bytes = Buffer.alloc(0);
  vi.stubEnv(
    "EXAMPLE_OPERATOR_GRANTS",
    JSON.stringify(
      ["a", "b"].map((subject) => ({ issuer, subject, scope: subject })),
    ),
  );
  vi.stubEnv("BOAT_API_KEY", "synthetic-fork-key");
  vi.stubEnv("BOAT_ORG", "personal");
  vi.stubEnv(
    "EXAMPLE_LIVE_RUN_PLAN",
    JSON.stringify({
      runId: "synthetic-fork",
      scope: "example-boat:a",
      accountId: "account",
      wallet: "personal",
      walletTeamId: null,
      size: "small",
      expiresAt: Date.now() + 600000,
      maxMachines: 2,
      maxStarts: 3,
      maxConcurrent: 1,
      durationMinutes: 10,
      estimateUsd: 0.3,
      allowanceUsd: 1,
    }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = new URL(String(url));
      const reply = (value: unknown) =>
        new Response(
          JSON.stringify({ ok: true, ...(value as Record<string, unknown>) }),
        );
      if (u.pathname.endsWith("/me")) return reply({ user: { id: "account" } });
      if (u.pathname.endsWith("/limits")) return reply({ canStart: true });
      if (u.pathname.endsWith("/fork")) {
        forkCount++;
        expect(JSON.parse(String(init?.body))).toMatchObject({
          noEnv: true,
          env: {},
        });
        if (lost)
          return new Response(
            JSON.stringify({ error: { message: "synthetic lost conflict" } }),
            { status: 409 },
          );
        return reply({
          id: "native-child",
          sandbox: { id: "native-child", state: "provisioning" },
        });
      }
      if (u.pathname.includes("/files")) {
        const path =
          init?.method === "PUT"
            ? JSON.parse(String(init.body)).path
            : u.searchParams.get("path");
        if (init?.method === "PUT")
          bytes = Buffer.from(JSON.parse(String(init.body)).content, "base64");
        const data =
          corrupt && u.pathname.includes("native-child")
            ? Buffer.from("wrong")
            : bytes;
        return reply({
          success: true,
          path,
          encoding: "base64",
          size: data.length,
          content: data.toString("base64"),
        });
      }
      if (u.pathname.endsWith("/stop")) {
        const child = u.pathname.includes("native-child");
        if (child) childStopped = true;
        return reply({
          id: child ? "native-child" : "native-source",
          stop: { id: child ? "stop-child" : "stop-one", status: "pending" },
        });
      }
      if (u.pathname.includes("/stops/")) {
        const child = u.pathname.includes("native-child");
        return reply({
          id: child ? "native-child" : "native-source",
          stop: { id: child ? "stop-child" : "stop-one", status: stop },
        });
      }
      const child = u.pathname.endsWith("/native-child");
      return reply({
        sandbox: {
          id: child ? "native-child" : "native-source",
          state: child
            ? childStopped
              ? "archived"
              : ready
                ? "ready"
                : "provisioning"
            : stop === "completed"
              ? "archived"
              : "archiving",
        },
      });
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
async function fixture() {
  const fork = await import("./fork");
  const t = convexTest(schema, {
    "./_generated/server.js": () => import("../_generated/server.js"),
    "./live/fork.ts": async () => fork,
    "./live/lifecycle.ts": async () => lifecycle,
    "./live/allowance.ts": async () => allowance,
  });
  const c = register(t),
    a = t.withIdentity({ issuer, subject: "a" }),
    b = t.withIdentity({ issuer, subject: "b" });
  const p = await a.query(
    makeFunctionReference<"query">("live/allowance:proposal"),
    {},
  );
  await a.action(action("allowance", "approve"), {
    reviewToken: p.reviewToken,
    acknowledgeRisk: true,
  });
  const sandbox = { scope: "example-boat:a", key: args.sourceKey };
  await t.mutation(c.registry.ensure, {
    sandbox,
    reference: { provider: "boat", providerId: "native-source" },
  });
  const ticket = await t.mutation(c.registry.beginRefresh, { sandbox });
  await t.mutation(c.registry.finishRefresh, {
    sandbox,
    ...ticket,
    result: { state: "running" },
  });
  await a.action(action("lifecycle", "prepareFixture"), {
    key: args.sourceKey,
  });
  await a.action(action("lifecycle", "run"), {
    key: args.sourceKey,
    action: "stop",
    operationId: "source",
  });
  return {
    t,
    c,
    a,
    b,
    sandbox,
    confirm: async () => {
      stop = "completed";
      await a.action(action("lifecycle", "inspect"), { key: args.sourceKey });
    },
  };
}
test("pending source stop refuses admission with no native fork", async () => {
  const { a } = await fixture();
  await expect(a.action(action("fork", "start"), args)).rejects.toThrow();
  expect(forkCount).toBe(0);
});
test("source identity and distinct child binding survive query reload without replay", async () => {
  const { a, confirm } = await fixture();
  await confirm();
  await Promise.all([
    a.action(action("fork", "start"), args),
    a.action(action("fork", "start"), args),
  ]);
  let view = await a.query(status, args);
  expect(view.source.reference.providerId).toBe("native-source");
  expect(view.intent.operationId).toBe("fork-research-child");
  expect(forkCount).toBe(1);
  ready = true;
  await a.action(action("fork", "inspect"), args);
  view = await a.query(status, args);
  expect(view.child.reference.providerId).toBe("native-child");
  expect(view.source.reference.providerId).toBe("native-source");
  await a.action(action("fork", "start"), args);
  expect(forkCount).toBe(1);
});
test("ready child matches retained source fixture bytes and mismatch is explicit", async () => {
  const { a, confirm } = await fixture();
  await confirm();
  await a.action(action("fork", "start"), args);
  ready = true;
  await a.action(action("fork", "inspect"), args);
  await a.action(action("fork", "verify"), args);
  expect((await a.query(status, args)).intent.copy).toBe("matched");
  corrupt = true;
  await a.action(action("fork", "verify"), args);
  expect((await a.query(status, args)).intent.copy).toBe("mismatch");
});
test("unknown child intent remains unresolved after lost fork reply without guessed IDs or replay", async () => {
  const { a, confirm } = await fixture();
  await confirm();
  lost = true;
  await a.action(action("fork", "start"), args);
  let view = await a.query(status, args);
  expect(view.operation.status).toBe("unknown");
  expect(view.child).toBeNull();
  await a.action(action("fork", "inspect"), args);
  await a.action(action("fork", "start"), args);
  view = await a.query(status, args);
  expect(view.intent.childKey).toBe(args.childKey);
  expect(view.intent.childId).toBeUndefined();
  expect(view.child).toBeNull();
  expect(forkCount).toBe(1);
  await expect(
    a.mutation(makeFunctionReference<"mutation">("live/allowance:reserve"), {
      runId: "synthetic-fork",
      intentKey: "create-research-child",
      machineKey: args.childKey,
      kind: "create",
    }),
  ).rejects.toThrow(/retained provisioning intent/i);
});
test("foreign sources and identical or occupied child keys start no fork", async () => {
  const { a, b, t, c, confirm } = await fixture();
  await confirm();
  await expect(b.action(action("fork", "start"), args)).rejects.toThrow();
  await expect(t.action(action("fork", "start"), args)).rejects.toThrow();
  await expect(
    a.action(action("fork", "start"), { ...args, childKey: args.sourceKey }),
  ).rejects.toThrow();
  await t.mutation(c.registry.ensure, {
    sandbox: { scope: "example-boat:a", key: args.childKey },
    reference: { provider: "boat", providerId: "existing-child" },
  });
  await expect(a.action(action("fork", "start"), args)).rejects.toThrow();
  expect(forkCount).toBe(0);
});

test("confirmed child stop releases only fork concurrency and preserves cumulative allowance", async () => {
  const { a, confirm } = await fixture();
  await confirm();
  await a.action(action("fork", "start"), args);
  ready = true;
  await a.action(action("fork", "inspect"), args);
  await a.action(action("fork", "verify"), args);
  const proposal = makeFunctionReference<"query">("live/allowance:proposal");
  const before = (await a.query(proposal, {})).approval;
  expect(before.activeReservations).toBe(1);
  await a.action(action("lifecycle", "run"), {
    key: args.childKey,
    action: "stop",
    operationId: "child",
  });
  await a.action(action("lifecycle", "inspect"), { key: args.childKey });
  const after = (await a.query(proposal, {})).approval;
  expect(after.activeReservations).toBe(0);
  expect(after.machinesReserved).toBe(before.machinesReserved);
  expect(after.startsReserved).toBe(before.startsReserved);
  expect(after.estimatedUsdReserved).toBe(before.estimatedUsdReserved);
});
