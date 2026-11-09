import { worktreeOwnershipFixture } from "../../../tests/boat/worktree-fixture";
import { readOwnership } from "../../../scripts/worktree/boat-ownership-store.mjs";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { register } from "@fantastic.dev/convex-sandbox/testing";
import { test, expect, beforeEach, afterEach, vi } from "vitest";
import schema from "../schema";
import * as allowance from "./allowance";
const create = makeFunctionReference<"action">("live/create:create");
const status = makeFunctionReference<"query">("live/create:status");
const proposal = makeFunctionReference<"query">("live/allowance:proposal");
const approve = makeFunctionReference<"action">("live/allowance:approve");
const refresh = makeFunctionReference<"action">("live/machines:refresh");
const issuer = "https://synthetic.clerk.accounts.dev";
let native = vi.fn(
  async (_url: unknown, _init?: RequestInit): Promise<Response> =>
    new Response(),
);
let lose = false;
let ownership: Awaited<ReturnType<typeof worktreeOwnershipFixture>>;
beforeEach(async () => {
  ownership = await worktreeOwnershipFixture();
  vi.stubEnv("EXAMPLE_WORKTREE_OWNERSHIP", JSON.stringify(ownership.owner));
  vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:19999");
  vi.stubEnv(
    "EXAMPLE_OPERATOR_GRANTS",
    JSON.stringify(
      ["a", "b"].map((subject) => ({ issuer, subject, scope: subject })),
    ),
  );
  vi.stubEnv("BOAT_API_KEY", "synthetic-create-only-key");
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
      maxMachines: 2,
      maxStarts: 2,
      maxConcurrent: 2,
      durationMinutes: 10,
      estimateUsd: 0.2,
      allowanceUsd: 1,
    }),
  );
  lose = false;
  native = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const index = await readOwnership(
      ownership.owner.directory,
      ownership.owner.id,
    );
    expect(index.intents[0]).toMatchObject({
      outcome: "unknown",
      nativeId: null,
      operationId: "create-research-one",
    });
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      type: "small",
      noEnv: true,
      visibility: "private",
    });
    if (lose) throw new TypeError("Synthetic lost reply");
    return new Response(
      JSON.stringify({
        ok: true,
        sandbox: { id: "synthetic-native", state: "ready" },
      }),
      { status: 202 },
    );
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      if (init?.method === "POST") return native(url, init);
      return new Response(
        JSON.stringify(
          String(url).endsWith("/me")
            ? { ok: true, user: { id: "synthetic-account" } }
            : String(url).includes("/sandboxes/")
              ? {
                  ok: true,
                  sandbox: { id: "synthetic-native", state: "ready" },
                }
              : { ok: true, canStart: true },
        ),
      );
    }),
  );
});
afterEach(async () => {
  await ownership.cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
async function fixture() {
  const functions = await import("./create");
  const t = convexTest(schema, {
    "./live/ownership.ts": () => import("./ownership"),
    "./live/ownershipData.ts": () => import("./ownershipData"),
    "./_generated/server.js": () => import("../_generated/server.js"),
    "./live/create.ts": async () => functions,
    "./live/allowance.ts": async () => allowance,
    "./live/machines.ts": () => import("./machines"),
  });
  const c = register(t);
  const a = t.withIdentity({ issuer, subject: "a" }),
    b = t.withIdentity({ issuer, subject: "b" });
  const p = await a.query(proposal, {});
  await a.action(approve, {
    reviewToken: p.reviewToken,
    acknowledgeRisk: true,
  });
  return { t, c, a, b };
}
test("duplicate creation dispatches one native POST with one component claim", async () => {
  const { a } = await fixture();
  await Promise.all([
    a.action(create, { key: "research-one" }),
    a.action(create, { key: "research-one" }),
  ]);
  expect(native).toHaveBeenCalledTimes(1);
  expect(
    (await a.query(status, { key: "research-one" })).provision.operationId,
  ).toBe("create-research-one");
  expect((await a.query(proposal, {})).approval.machinesReserved).toBe(1);
});
test("accepted creation stays pending until an independent registry refresh", async () => {
  const { a } = await fixture();
  await a.action(create, { key: "research-one" });
  expect(
    (await a.query(status, { key: "research-one" })).registry.observedState,
  ).toBe("starting");
  await a.action(refresh, {
    key: "research-one",
  });
  expect(
    (await a.query(status, { key: "research-one" })).registry.observedState,
  ).toBe("running");
});
test("lost reply retains the original unknown operation and financial slot across reload and retry", async () => {
  const { a } = await fixture();
  lose = true;
  await a.action(create, { key: "research-one" });
  const first = await a.query(status, { key: "research-one" });
  expect(first.provision.status).toBe("unknown");
  await a.action(makeFunctionReference<"action">("live/ownership:retain"), {
    key: "research-one",
    kind: "create",
  });
  expect(
    (await readOwnership(ownership.owner.directory, ownership.owner.id))
      .intents[0],
  ).toMatchObject({ outcome: "unknown", nativeId: null });
  expect(
    (await a.query(status, { key: "research-one" })).provision.operationId,
  ).toBe(first.provision.operationId);
  await a.action(create, { key: "research-one" });
  expect(native).toHaveBeenCalledTimes(1);
  expect((await a.query(proposal, {})).approval.activeReservations).toBe(1);
});
test("foreign and anonymous callers, forged fields and changed wallet cannot dispatch", async () => {
  const { t, a, b } = await fixture();
  await expect(b.action(create, { key: "research-one" })).rejects.toThrow();
  await expect(t.action(create, { key: "research-one" })).rejects.toThrow();
  await expect(
    a.action(create, {
      key: "research-one",
      scope: "example-boat:b",
      providerId: "foreign",
    }),
  ).rejects.toThrow();
  vi.stubEnv("BOAT_ORG", "other-wallet");
  await expect(a.action(create, { key: "research-one" })).rejects.toThrow();
  expect(native).not.toHaveBeenCalled();
  expect((await b.query(status, { key: "research-one" })).reservationHeld).toBe(
    false,
  );
});

test("an interrupted reservation before the component claim is retained without redispatch", async () => {
  const { a } = await fixture();
  await a.mutation(
    makeFunctionReference<"mutation">("live/allowance:reserve"),
    {
      runId: "synthetic-run",
      intentKey: "create-research-one",
      machineKey: "research-one",
      kind: "create",
    },
  );
  const reloaded = await a.query(status, { key: "research-one" });
  expect(reloaded.reservationHeld).toBe(true);
  expect(reloaded.provision).toBeNull();
  await a.action(create, { key: "research-one" });
  expect(native).not.toHaveBeenCalled();
  expect((await a.query(proposal, {})).approval.activeReservations).toBe(1);
});

test("external ownership binds exact ID and generation from the shared create", async () => {
  const { a } = await fixture();
  await a.action(create, { key: "research-one" });
  const index = await readOwnership(
    ownership.owner.directory,
    ownership.owner.id,
  );
  expect(index.intents[0]).toMatchObject({
    nativeId: "synthetic-native",
    generation: 1,
    operationId: "create-research-one",
    accountId: "synthetic-account",
  });
});
test("unavailable ownership index prevents native dispatch", async () => {
  const { a } = await fixture();
  vi.stubEnv("EXAMPLE_WORKTREE_OWNERSHIP", "");
  await a.action(create, { key: "research-one" });
  expect(native).not.toHaveBeenCalled();
});
