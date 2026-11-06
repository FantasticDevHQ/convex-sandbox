import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { register } from "@fantastic.dev/convex-sandbox/testing";
import { beforeEach, afterEach, test, expect, vi } from "vitest";
import schema from "../schema";
const load = makeFunctionReference<"action">("live/catalog:load");
const issuer = "https://synthetic.clerk.accounts.dev";
let calls = 0;
beforeEach(() => {
  calls = 0;
  vi.stubEnv(
    "EXAMPLE_OPERATOR_GRANTS",
    JSON.stringify(
      ["a", "b"].map((subject) => ({ issuer, subject, scope: subject })),
    ),
  );
  vi.stubEnv("BOAT_API_KEY", "synthetic-catalog-key");
  vi.stubEnv("BOAT_ORG", "personal");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      expect(init?.method ?? "GET").toBe("GET");
      expect(new URL(String(url)).pathname.endsWith("/saved-snapshots")).toBe(
        true,
      );
      calls++;
      return new Response(
        JSON.stringify({
          ok: true,
          snapshots: [
            {
              name: "saving-one",
              sourceSandboxId: "native-one",
              status: "saving",
            },
            {
              name: "ready-one",
              sourceSandboxId: "native-one",
              status: "ready",
              snapshotId: "artifact-one",
            },
            {
              name: "sibling-private",
              sourceSandboxId: "native-two",
              status: "ready",
              snapshotId: "artifact-two",
            },
          ],
        }),
      );
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
async function fixture() {
  const catalog = await import("./catalog");
  const t = convexTest(schema, {
    "./_generated/server.js": () => import("../_generated/server.js"),
    "./live/catalog.ts": async () => catalog,
  });
  const c = register(t),
    a = t.withIdentity({ issuer, subject: "a" }),
    b = t.withIdentity({ issuer, subject: "b" });
  for (const key of ["one", "two"])
    await t.mutation(c.registry.ensure, {
      sandbox: { scope: "example-boat:a", key },
      reference: { provider: "boat", providerId: `native-${key}` },
    });
  return { t, a, b };
}
test("source scope excludes sibling entries and saving means pending", async () => {
  const { a } = await fixture();
  const one = await a.action(load, {
    key: "one",
    generation: 1,
    providerId: "native-one",
  });
  expect(
    one.page.items.map(
      (item: { reference: { id: string } }) => item.reference.id,
    ),
  ).toEqual(["saving-one", "ready-one"]);
  expect(one.page.items[0].readiness).toBe("pending");
  expect(JSON.stringify(one)).not.toContain("sibling-private");
  const two = await a.action(load, {
    key: "two",
    generation: 1,
    providerId: "native-two",
  });
  expect(
    two.page.items.map(
      (item: { reference: { id: string } }) => item.reference.id,
    ),
  ).toEqual(["sibling-private"]);
  expect(calls).toBe(2);
});
test("capability declaration keeps connection, capture, restore and transfers unsupported", async () => {
  const { a } = await fixture();
  const result = await a.action(load, {
    key: "one",
    generation: 1,
    providerId: "native-one",
  });
  for (const capability of [
    "getConnection",
    "createTemplate",
    "snapshotDisk",
    "restore",
    "transferFile",
  ])
    expect(result.capabilities.supported).not.toContain(capability);
  expect(result.capabilities.supported).toContain("listTemplates");
  expect(JSON.stringify(result)).not.toContain("synthetic-catalog-key");
});
test("foreign, anonymous and stale selections dispatch no native catalog request", async () => {
  const { a, b, t } = await fixture();
  for (const caller of [b, t])
    await expect(
      caller.action(load, {
        key: "one",
        generation: 1,
        providerId: "native-one",
      }),
    ).rejects.toThrow();
  await expect(
    a.action(load, { key: "one", generation: 2, providerId: "native-one" }),
  ).rejects.toThrow();
  expect(calls).toBe(0);
});
