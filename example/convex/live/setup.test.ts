import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "../schema";
const configuration = makeFunctionReference<"query">(
  "live/setup:configuration",
);
const readiness = makeFunctionReference<"action">("live/setup:readiness");
const identity = {
  issuer: "https://synthetic.clerk.accounts.dev",
  subject: "operator",
};
const key = "synthetic-server-only-boat-key";
const fixture = () =>
  convexTest(schema, {
    "./_generated/server.js": () => import("../_generated/server.js"),
    "./live/setup.ts": () => import("./setup"),
  });
beforeEach(() => {
  vi.stubEnv(
    "EXAMPLE_OPERATOR_GRANTS",
    JSON.stringify([{ ...identity, scope: "example:operator" }]),
  );
  vi.stubEnv("BOAT_API_KEY", key);
  vi.stubEnv("BOAT_ORG", "personal");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function provider() {
  const calls: Array<{ path: string; method: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      calls.push({ path, method: init?.method ?? "GET" });
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        `Bearer ${key}`,
      );
      expect(new Headers(init?.headers).get("X-Boat-Org")).toBe("personal");
      if (path === "/api/v1/me")
        return new Response(
          JSON.stringify({
            ok: true,
            type: "user.info",
            user: { id: "account-fixture", email: key, displayName: key },
          }),
        );
      if (path === "/api/v1/limits")
        return new Response(
          JSON.stringify({
            ok: true,
            type: "limits",
            canStart: true,
            activeSandboxes: 0,
            maxActiveSandboxes: 2,
            contactMessage: key,
            wallet: { secret: key },
          }),
        );
      throw new Error("Unexpected provider request");
    }),
  );
  return calls;
}
test("read-only readiness", async () => {
  const calls = provider();
  const result = await fixture().withIdentity(identity).action(readiness, {});
  expect(result.state).toBe("checked");
  expect(result.accountId).toBe("account-fixture");
  expect(result.canStart).toBe(true);
  expect(calls).toEqual([
    { path: "/api/v1/me", method: "GET" },
    { path: "/api/v1/limits", method: "GET" },
  ]);
});
test("secret projection", async () => {
  provider();
  const t = fixture().withIdentity(identity);
  for (const response of [
    await t.query(configuration, {}),
    await t.action(readiness, {}),
  ]) {
    expect(JSON.stringify(response)).not.toContain(key);
    expect(JSON.stringify(response)).not.toContain("email");
  }
});
test("missing configuration never invokes the provider", async () => {
  const calls = provider();
  vi.stubEnv("BOAT_API_KEY", "");
  const t = fixture().withIdentity(identity);
  expect((await t.query(configuration, {})).missing).toEqual(["BOAT_API_KEY"]);
  expect((await t.action(readiness, {})).state).toBe("missing");
  expect(calls).toEqual([]);
});
test("anonymous and foreign callers cannot inspect configuration or call Boat", async () => {
  const calls = provider();
  const t = fixture();
  for (const caller of [
    t,
    t.withIdentity({ ...identity, subject: "foreign" }),
  ]) {
    await expect(caller.query(configuration, {})).rejects.toThrow();
    await expect(caller.action(readiness, {})).rejects.toThrow();
  }
  expect(calls).toEqual([]);
});

test("provider failures are projected without body text or retries", async () => {
  const fetch = vi.fn(
    async () => new Response(JSON.stringify({ error: key }), { status: 403 }),
  );
  vi.stubGlobal("fetch", fetch);
  const result = await fixture().withIdentity(identity).action(readiness, {});
  expect(result.state).toBe("unavailable");
  expect(result.accountId).toBeNull();
  expect(JSON.stringify(result)).not.toContain(key);
  expect(fetch).toHaveBeenCalledTimes(1);
});
test("secrets in allowlisted provider fields are rejected", async () => {
  const fetch = vi.fn(
    async (url: string | URL | Request) =>
      new Response(
        JSON.stringify(
          String(url).includes("/me")
            ? { ok: true, user: { id: key } }
            : { ok: true, canStart: true },
        ),
      ),
  );
  vi.stubGlobal("fetch", fetch);
  const result = await fixture().withIdentity(identity).action(readiness, {});
  expect(result.state).toBe("unavailable");
  expect(JSON.stringify(result)).not.toContain(key);
});
test("unreported counts and start readiness remain unknown", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string | URL | Request) =>
        new Response(
          JSON.stringify(
            String(url).includes("/me")
              ? { ok: true, user: { id: "account-fixture" } }
              : { ok: true },
          ),
        ),
    ),
  );
  const result = await fixture().withIdentity(identity).action(readiness, {});
  expect(result.state).toBe("checked");
  expect(result.canStart).toBeNull();
  expect(result.activeSandboxes).toBeNull();
  expect(result.maxActiveSandboxes).toBeNull();
});

test("organization selection is server-owned and its actual ID is projected", async () => {
  vi.stubEnv("BOAT_ORG", "approved-wallet");
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("X-Boat-Org")).toBe(
        "approved-wallet",
      );
      const parsed = new URL(String(url));
      requests.push(parsed.pathname);
      if (parsed.pathname.endsWith("/limits")) {
        expect(parsed.searchParams.get("org")).toBe("approved-wallet");
        return new Response(
          JSON.stringify({ ok: true, teamId: "team-fixture", canStart: false }),
        );
      }
      return new Response(
        JSON.stringify({ ok: true, user: { id: "account-fixture" } }),
      );
    }),
  );
  const t = fixture().withIdentity(identity);
  await expect(t.action(readiness, { org: "foreign" })).rejects.toThrow();
  expect(requests).toEqual([]);
  const result = await t.action(readiness, {});
  expect(result.wallet).toBe("approved-wallet");
  expect(result.walletTeamId).toBe("team-fixture");
  expect(result.canStart).toBe(false);
});
