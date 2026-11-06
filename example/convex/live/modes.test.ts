import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { register } from "@fantastic.dev/convex-sandbox/testing";
import { api } from "../_generated/api";
import schema from "../schema";
import { scopeFor } from "../demo/contracts";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const identity = {
  issuer: "https://synthetic.clerk.accounts.dev",
  subject: "operator",
};
const fixture = () => {
  const t = convexTest(schema, {
    "./_generated/server.js": () => import("../_generated/server.js"),
    "./demo.ts": () => import("../demo"),
    "./demo/store.ts": () => import("../demo/store"),
    "./live/access.ts": () => import("./access"),
    "./live/setup.ts": () => import("./setup"),
  });
  return { t, c: register(t) };
};
beforeEach(() => {
  vi.stubEnv("CONVEX_SITE_URL", "http://127.0.0.1:3211");
  vi.stubEnv("BOAT_API_KEY", "synthetic-unused-key");
  vi.stubEnv("BOAT_ORG", "personal");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
test("no native dispatch", async () => {
  const native = vi.fn(async () => {
    throw new Error("Native request forbidden in simulator mode");
  });
  vi.stubGlobal("fetch", native);
  const { t } = fixture();
  await t.action(api.demo.seed, {});
  await t.action(api.demo.lifecycle, {
    profile: "persistent",
    action: "stop",
    operationId: "sim-stop",
  });
  const rows = await t.query(api.demo.list, {});
  expect(rows.page).toHaveLength(3);
  expect(native).not.toHaveBeenCalled();
});
test("Boat operator scopes cannot share simulator namespaces", async () => {
  const { t, c } = fixture();
  const seed = await t.action(api.demo.seed, {});
  const simulatorScope = scopeFor(seed.epoch);
  vi.stubEnv(
    "EXAMPLE_OPERATOR_GRANTS",
    JSON.stringify([{ ...identity, scope: simulatorScope }]),
  );
  const access = await t
    .withIdentity(identity)
    .action(api.live.access.checkAccess, {});
  expect(access.scope).toBe(`example-boat:${simulatorScope}`);
  await t.mutation(c.registry.ensure, {
    sandbox: { scope: access.scope, key: "persistent" },
    reference: { provider: "boat", providerId: "synthetic-boat-reference" },
  });
  const sim = await t.query(c.registry.get, {
    sandbox: { scope: simulatorScope, key: "persistent" },
  });
  expect(sim?.reference.provider).toBe("simulated-persistent");
});
test("failed Boat reads cannot seed or return simulator state", async () => {
  vi.stubEnv(
    "EXAMPLE_OPERATOR_GRANTS",
    JSON.stringify([{ ...identity, scope: "operator" }]),
  );
  const native = vi.fn(
    async () => new Response("synthetic native failure", { status: 503 }),
  );
  vi.stubGlobal("fetch", native);
  const { t } = fixture();
  const result = await t
    .withIdentity(identity)
    .action(makeFunctionReference("live/setup:readiness"), {});
  expect(result.state).toBe("unavailable");
  expect(result.accountId).toBeNull();
  expect((await t.query(api.demo.info, {})).initialized).toBe(false);
  expect((await t.query(api.demo.list, {})).page).toEqual([]);
  expect(native).toHaveBeenCalledTimes(1);
});
