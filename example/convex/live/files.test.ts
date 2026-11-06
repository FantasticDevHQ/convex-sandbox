import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { register } from "@fantastic.dev/convex-sandbox/testing";
import { beforeEach, afterEach, test, expect, vi } from "vitest";
import schema from "../schema";
import * as allowance from "./allowance";
const action = (name: string) =>
  makeFunctionReference<"action">(`live/files:${name}`);
const target = { key: "research-one", generation: 1, providerId: "native-a" };
const path = "/home/user/demo/example.txt";
const issuer = "https://synthetic.clerk.accounts.dev";
let calls: Array<{ url: URL; init?: RequestInit }> = [];
let disk = new Map<string, Uint8Array>();
beforeEach(() => {
  calls = [];
  disk = new Map();
  vi.stubEnv(
    "EXAMPLE_OPERATOR_GRANTS",
    JSON.stringify(
      ["a", "b"].map((subject) => ({ issuer, subject, scope: subject })),
    ),
  );
  vi.stubEnv("BOAT_API_KEY", "synthetic-file-key");
  vi.stubEnv("BOAT_ORG", "personal");
  vi.stubEnv(
    "EXAMPLE_LIVE_RUN_PLAN",
    JSON.stringify({
      runId: "synthetic-files",
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
      calls.push({ url: u, init });
      const reply = (value: unknown) =>
        new Response(
          JSON.stringify({ ok: true, ...(value as Record<string, unknown>) }),
        );
      if (u.pathname.endsWith("/me"))
        return reply({ ok: true, user: { id: "account" } });
      if (u.pathname.endsWith("/limits"))
        return reply({ ok: true, canStart: true });
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        const data = Buffer.from(body.content, "base64");
        disk.set(body.path, data);
        return reply({
          success: true,
          path: body.path,
          encoding: "base64",
          size: data.length,
        });
      }
      const requested = u.searchParams.get("path") ?? "";
      if (init?.method === "DELETE") {
        expect(u.searchParams.get("recursive")).toBe("false");
        disk.delete(requested);
        return reply({ success: true, path: requested });
      }
      if (u.pathname.endsWith("/files/list"))
        return reply({
          success: true,
          path: requested,
          truncated: false,
          files: [...disk].map(([path, data]) => ({
            name: path.split("/").at(-1),
            path,
            size: data.length,
            isDir: false,
            isSymlink: false,
          })),
        });
      const data = disk.get(requested) ?? new Uint8Array();
      return reply({
        success: true,
        path: requested,
        encoding: "base64",
        size: data.length,
        content: Buffer.from(data).toString("base64"),
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
  const files = await import("./files");
  const t = convexTest(schema, {
    "./_generated/server.js": () => import("../_generated/server.js"),
    "./live/files.ts": async () => files,
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
  const sandbox = { scope: "example-boat:a", key: target.key };
  await t.mutation(c.registry.ensure, {
    sandbox,
    reference: { provider: "boat", providerId: target.providerId },
  });
  const ticket = await t.mutation(c.registry.beginRefresh, { sandbox });
  await t.mutation(c.registry.finishRefresh, {
    sandbox,
    ...ticket,
    result: { state: "running" },
  });
  calls = [];
  return { t, c, a, b, sandbox };
}
test("denied path rejects traversal and encoded escapes before any native dispatch", async () => {
  const { a } = await fixture();
  for (const name of [
    "/etc/passwd",
    "/home/user/demo/../secret",
    "/home/user/demo/%2e%2e/a",
    "/home/user/demo2/a",
    "/home/user/demo/a/b",
    "/home/user/demo/a\\b",
    "/home/user/demo/a\u0000",
  ])
    await expect(
      a.action(action("read"), { ...target, path: name }),
    ).rejects.toThrow();
  expect(calls).toHaveLength(0);
});
test("byte limit rejects UTF8 byte overflow before a native write", async () => {
  const { a } = await fixture();
  await expect(
    a.action(action("write"), {
      ...target,
      path,
      operationId: "file-overflow",
      data: new TextEncoder().encode("😀".repeat(16385)).buffer,
    }),
  ).rejects.toThrow();
  expect(calls).toHaveLength(0);
});
test("exact bytes round trip and nonrecursive delete refreshes the same list", async () => {
  const { a } = await fixture();
  const data = new Uint8Array([0, 255, 239, 187, 191, 97, 10]).buffer;
  expect(
    await a.action(action("write"), {
      ...target,
      path,
      operationId: "file-write",
      data,
    }),
  ).toMatchObject({ bytesWritten: 7, partial: false });
  const read = await a.action(action("read"), { ...target, path });
  expect(new Uint8Array(read.data)).toEqual(new Uint8Array(data));
  expect((await a.action(action("list"), target)).entries[0].path).toBe(path);
  expect(
    await a.action(action("remove"), {
      ...target,
      path,
      confirmPath: path,
      operationId: "file-delete",
    }),
  ).toEqual({ deleted: true });
  expect((await a.action(action("list"), target)).entries).toEqual([]);
});
test("foreign, anonymous, stale target and mismatched confirmation refuse before native calls", async () => {
  const { a, b, t } = await fixture();
  for (const caller of [b, t])
    await expect(
      caller.action(action("read"), { ...target, path }),
    ).rejects.toThrow();
  await expect(
    a.action(action("read"), { ...target, generation: 2, path }),
  ).rejects.toThrow();
  await expect(
    a.action(action("remove"), {
      ...target,
      path,
      confirmPath: "different",
      operationId: "file-delete",
    }),
  ).rejects.toThrow();
  expect(calls).toHaveLength(0);
});

test("expired approval blocks changes while owned read recovery remains available", async () => {
  const { a } = await fixture();
  disk.set(path, new TextEncoder().encode("retained"));
  vi.stubEnv("EXAMPLE_LIVE_RUN_PLAN", "");
  await expect(
    a.action(action("write"), {
      ...target,
      path,
      operationId: "file-expired",
      data: new ArrayBuffer(0),
    }),
  ).rejects.toThrow();
  expect(calls).toHaveLength(0);
  const read = await a.action(action("read"), { ...target, path });
  expect(new TextDecoder().decode(read.data)).toBe("retained");
  expect(calls.every((call) => (call.init?.method ?? "GET") === "GET")).toBe(
    true,
  );
});
