import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { register } from "@fantastic.dev/convex-sandbox/testing";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "../schema";
import * as machineFunctions from "./machines";
const list = makeFunctionReference<"query">("live/machines:list");
const get = makeFunctionReference<"query">("live/machines:get");
const refresh = makeFunctionReference<"action">("live/machines:refresh");
const issuer = "https://synthetic.clerk.accounts.dev";
const identity = (subject: string) => ({ issuer, subject });
const key = "synthetic-server-only-key";
beforeEach(() => {
  vi.stubEnv(
    "EXAMPLE_OPERATOR_GRANTS",
    JSON.stringify(
      ["a", "b"].map((subject) => ({ issuer, subject, scope: subject })),
    ),
  );
  vi.stubEnv("BOAT_API_KEY", key);
  vi.stubEnv("BOAT_ORG", "personal");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function fixture() {
  const t = convexTest(schema, {
    "./_generated/server.js": () => import("../_generated/server.js"),
    "./live/machines.ts": async () => machineFunctions,
  });
  const c = register(t);
  for (const subject of ["a", "b"])
    await t.mutation(c.registry.ensure, {
      sandbox: { scope: `example-boat:${subject}`, key: `${subject}-machine` },
      reference: { provider: "boat", providerId: `native-${subject}` },
    });
  await t.mutation(c.registry.ensure, {
    sandbox: { scope: "example-boat:a", key: "not-boat" },
    reference: { provider: "simulated", providerId: "synthetic" },
  });
  return {
    t,
    c,
    a: t.withIdentity(identity("a")),
    b: t.withIdentity(identity("b")),
  };
}
test("scoped list", async () => {
  const { a, b } = await fixture();
  for (const [caller, subject] of [
    [a, "a"],
    [b, "b"],
  ] as const) {
    const result = await caller.query(list, {
      paginationOpts: { cursor: null, numItems: 20 },
    });
    expect(result.page.map((row: { key: string }) => row.key)).toEqual([
      `${subject}-machine`,
    ]);
  }
  await expect(
    a.query(list, { paginationOpts: { cursor: null, numItems: 100 } }),
  ).rejects.toThrow();
  await expect(
    a.query(list, {
      scope: "example-boat:b",
      paginationOpts: { cursor: null, numItems: 20 },
    }),
  ).rejects.toThrow();
});
test("foreign keys, anonymous calls and alternate providers cannot dispatch", async () => {
  const native = vi.fn(async () => {
    throw new Error("Unexpected native request");
  });
  vi.stubGlobal("fetch", native);
  const { t, a, b } = await fixture();
  expect(await b.query(get, { key: "a-machine" })).toBeNull();
  expect(await a.query(get, { key: "not-boat" })).toBeNull();
  await expect(b.action(refresh, { key: "a-machine" })).rejects.toThrow();
  await expect(a.action(refresh, { key: "not-boat" })).rejects.toThrow();
  await expect(
    t.query(list, { paginationOpts: { cursor: null, numItems: 20 } }),
  ).rejects.toMatchObject({ data: { code: "authentication" } });
  await expect(
    a.action(refresh, { key: "a-machine", providerId: "foreign" }),
  ).rejects.toThrow();
  expect(native).not.toHaveBeenCalled();
});
test("refresh returns the accepted registry observation and preserves unknown memory", async () => {
  const { a } = await fixture();
  let state = "ready";
  const native = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://boat.dev/api/v1/sandboxes/native-a");
      expect(init?.method).toBe("GET");
      return new Response(
        JSON.stringify({
          ok: true,
          sandbox: { id: "native-a", state, vcpu: 2, desktopUrl: key },
        }),
      );
    },
  );
  vi.stubGlobal("fetch", native);
  const running = await a.action(refresh, { key: "a-machine" });
  expect(running.observedState).toBe("running");
  expect(running.resources?.memoryMiB).toBeUndefined();
  state = "archived";
  const stopped = await a.action(refresh, { key: "a-machine" });
  expect(stopped.observedState).toBe("stopped");
  expect(stopped.refresh.status).toBe("fresh");
  expect(await a.query(get, { key: "a-machine" })).toEqual(stopped);
  expect(JSON.stringify(stopped)).not.toContain(key);
  expect(native).toHaveBeenCalledTimes(2);
});
test("a native failure retains the last accepted state and exposes a failed refresh", async () => {
  const { a } = await fixture();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            sandbox: { id: "native-a", state: "ready" },
          }),
        ),
    ),
  );
  await a.action(refresh, { key: "a-machine" });
  const native = vi.fn(async () => new Response(key, { status: 503 }));
  vi.stubGlobal("fetch", native);
  const failed = await a.action(refresh, { key: "a-machine" });
  expect(failed.observedState).toBe("running");
  expect(failed.refresh.status).toBe("failed");
  expect(JSON.stringify(failed)).not.toContain(key);
  expect(native).toHaveBeenCalledTimes(1);
});

test("a rebind during refresh cannot accept the old native observation", async () => {
  const { t, c, a } = await fixture();
  const sandbox = { scope: "example-boat:a", key: "a-machine" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const deleted = await t.mutation(c.registry.beginRefresh, { sandbox });
      await t.mutation(c.registry.finishRefresh, {
        sandbox,
        ...deleted,
        result: { state: "deleted" },
      });
      const row = await t.query(c.registry.get, { sandbox });
      if (!row) throw new Error("No fixture binding");
      await t.mutation(c.registry.rebind, {
        sandbox,
        expectedVersion: row.version,
        reference: { provider: "boat", providerId: "native-rebound" },
      });
      return new Response(
        JSON.stringify({
          ok: true,
          sandbox: { id: "native-a", state: "ready", vcpu: 8 },
        }),
      );
    }),
  );
  const result = await a.action(refresh, { key: "a-machine" });
  expect(result.reference.providerId).toBe("native-rebound");
  expect(result.observedState).toBe("unknown");
  expect(result.resources).toBeUndefined();
});
test("missing credentials never substitute simulator data or invoke native requests", async () => {
  const { a } = await fixture();
  vi.stubEnv("BOAT_API_KEY", "");
  const native = vi.fn(async () => {
    throw new Error("Unexpected native request");
  });
  vi.stubGlobal("fetch", native);
  await expect(a.action(refresh, { key: "a-machine" })).rejects.toMatchObject({
    data: { code: "unsupported" },
  });
  expect((await a.query(get, { key: "a-machine" }))?.observedState).toBe(
    "unknown",
  );
  expect(native).not.toHaveBeenCalled();
});
