import { convexTest } from "convex-test";
import { defineSchema } from "convex/server";
import { expect, test } from "vitest";
import {
  register,
  createTestStores,
} from "@fantastic.dev/convex-sandbox/testing";
import { SandboxProviders } from "@fantastic.dev/convex-sandbox";
import { createBoatProvider } from "@fantastic.dev/convex-sandbox/boat";

const sandbox = { scope: "boat-log-fixture", key: "machine" };
const handle = { sandbox, operationId: "command" };
const context = () => ({
  idempotencyKey: "log-key",
  signal: new AbortController().signal,
});
async function fixture() {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const state = {
    stdout: Buffer.from("hello"),
    stderr: Buffer.from("warning"),
    done: false,
    status: 200,
    gap: 0,
    corrupt: "",
    failStream: "",
  };
  const provider = createBoatProvider({
    apiKey: "synthetic-logs-key",
    fetch: async (url, init = {}) => {
      const u = new URL(String(url));
      calls.push({ url: u, init });
      if (init.method === "POST")
        return new Response(
          JSON.stringify({
            ok: true,
            success: true,
            type: "command.started",
            commandId: "cmd-1",
          }),
        );
      if (state.status !== 200)
        return new Response(
          JSON.stringify({
            error: {
              code: "agent_outdated",
              message: "synthetic-private-error",
            },
          }),
          { status: state.status },
        );
      const stream = u.searchParams.get("stream") as "stdout" | "stderr";
      if (state.failStream === stream)
        return new Response(null, { status: 500 });
      const offset = Number(u.searchParams.get("offset")) + state.gap;
      const data = state[stream].subarray(
        offset,
        offset + Number(u.searchParams.get("limit")),
      );
      const nextOffset = offset + data.length;
      const reply: Record<string, unknown> = {
        ok: true,
        type: "command.logs",
        commandId: "cmd-1",
        stream,
        offset,
        nextOffset,
        size: state[stream].length,
        encoding: "base64",
        data: data.toString("base64"),
        done: state.done && nextOffset === state[stream].length,
      };
      if (state.corrupt === "missing") delete reply.nextOffset;
      if (state.corrupt === "identity") reply.commandId = "foreign";
      if (state.corrupt === "encoding") reply.encoding = "utf8";
      if (state.corrupt === "backward") reply.offset = -1;
      if (state.corrupt === "advance") reply.nextOffset = nextOffset + 1;
      if (state.corrupt === "base64") reply.data = "!!!!";
      return new Response(JSON.stringify(reply));
    },
  });
  const t = convexTest(defineSchema({}), {
    "./_generated/server.js": () =>
      import("../../example/convex/_generated/server.js"),
  });
  const c = register(t),
    stores = createTestStores(t, c, () => true);
  await t.mutation(c.registry.ensure, {
    sandbox,
    reference: { provider: "boat", providerId: "vm-1" },
  });
  const client = () => {
    const p = new SandboxProviders({ authorize: async () => {} });
    p.register(provider);
    return p.execution(stores.execution);
  };
  await client().start({
    ...handle,
    input: { kind: "shell", command: "printf synthetic" },
  });
  const rawLogs = provider.adapter.execution?.logs;
  if (!rawLogs) throw new Error("Boat log adapter unavailable");
  const read = (cursor: string | null = null, maxBytes = 16384) =>
    rawLogs("vm-1", "cmd-1", { cursor, maxBytes, maxEntries: 16 }, context());
  return { state, calls, provider, client, read, rawLogs };
}

test("history byte offsets append only new bytes across polls and reconstructed clients", async () => {
  const f = await fixture();
  await f.client().syncLogs(handle);
  await f.client().syncLogs(handle);
  f.state.stdout = Buffer.from("hello world");
  f.state.stderr = Buffer.from("warning!");
  f.state.done = true;
  await f.client().syncLogs(handle);
  const count = f.calls.length;
  await f.client().syncLogs(handle);
  const logs = await f.client().logs({ ...handle, cursor: null });
  expect(
    logs.entries
      .filter((e) => e.stream === "stdout")
      .map((e) => e.text)
      .join(""),
  ).toBe("hello world");
  expect(
    logs.entries
      .filter((e) => e.stream === "stderr")
      .map((e) => e.text)
      .join(""),
  ).toBe("warning!");
  expect(logs.truncated).toBe(false);
  expect(f.calls).toHaveLength(count + 2);
  expect(
    f.calls
      .slice(1)
      .every(
        (c) =>
          c.init.method === "GET" &&
          c.url.pathname.endsWith("/command-history/cmd-1/logs") &&
          c.url.searchParams.get("encoding") === "base64",
      ),
  ).toBe(true);
});

test("UTF-8 split at a native page or growing-stream boundary is emitted once", async () => {
  const f = await fixture();
  f.state.stdout = Buffer.from(`${"a".repeat(1023)}😀z`);
  f.state.stderr = Buffer.alloc(0);
  const a = await f.read();
  const b = await f.read(a.nextCursor);
  expect([...a.entries, ...b.entries].map((e) => e.text).join("")).toBe(
    `${"a".repeat(1023)}😀z`,
  );
  f.state.stdout = Buffer.from([0xf0, 0x9f]);
  f.state.done = true;
  const partial = await f.read();
  expect(partial.entries).toEqual([]);
  f.state.stdout = Buffer.from("😀");
  f.state.done = true;
  const full = await f.read(partial.nextCursor);
  expect(full.entries).toEqual([{ stream: "stdout", text: "😀" }]);
  expect(full.complete).toBe(false);
});

test("retention gaps and invalid UTF-8 are explicitly truncated", async () => {
  const f = await fixture();
  f.state.gap = 2;
  expect((await f.read()).truncated).toBe(true);
  f.state.gap = 0;
  f.state.stdout = Buffer.from([0xff, 0xf0, 0x9f]);
  f.state.stderr = Buffer.alloc(0);
  f.state.done = true;
  const page = await f.read();
  expect(page.truncated).toBe(true);
  expect(page.complete).toBe(false);
});

test.each(["missing", "identity", "encoding", "backward", "advance", "base64"])(
  "invalid history offsets/identity fail without publishing a cursor: %s",
  async (corrupt) => {
    const f = await fixture();
    f.state.corrupt = corrupt;
    await expect(f.read()).rejects.toMatchObject({
      data: { code: "validation" },
    });
  },
);

test("agent_outdated/conflict cannot fabricate offsets or append tail fallback", async () => {
  const f = await fixture();
  await f.client().syncLogs(handle);
  f.state.status = 409;
  await f.client().syncLogs(handle);
  expect(await f.client().get(handle)).toMatchObject({
    logErrorCode: "unknown_outcome",
    outputBytes: 12,
  });
  f.state.status = 200;
  f.state.stdout = Buffer.from("hello!");
  await f.client().syncLogs(handle);
  expect(
    (await f.client().logs({ ...handle, cursor: null })).entries
      .filter((e) => e.stream === "stdout")
      .map((e) => e.text)
      .join(""),
  ).toBe("hello!");
  expect(f.calls.every((c) => !c.url.pathname.includes("/commands/"))).toBe(
    true,
  );
  expect(JSON.stringify(await f.client().get(handle))).not.toContain(
    "synthetic-private",
  );
});

test("page budgets bound decoded text, and a foreign/malformed cursor dispatches no request", async () => {
  const f = await fixture();
  f.state.stdout = Buffer.alloc(3000, 0xff);
  f.state.stderr = Buffer.alloc(3000, 0xff);
  const page = await f.read(null, 24);
  expect(
    Buffer.byteLength(page.entries.map((e) => e.text).join("")),
  ).toBeLessThanOrEqual(24);
  const count = f.calls.length;
  await expect(
    f.rawLogs(
      "vm-2",
      "cmd-1",
      { cursor: page.nextCursor, maxEntries: 16, maxBytes: 24 },
      context(),
    ),
  ).rejects.toMatchObject({ data: { code: "validation" } });
  await expect(f.read("bad")).rejects.toMatchObject({
    data: { code: "validation" },
  });
  expect(f.calls).toHaveLength(count);
});

test("PID-only cancellation stays unsupported with no DELETE or fabricated completion", async () => {
  const f = await fixture();
  const count = f.calls.length;
  await expect(f.client().cancel(handle)).rejects.toMatchObject({
    data: { code: "unsupported", capability: "cancelExecution" },
  });
  expect(f.calls).toHaveLength(count);
  expect(await f.client().get(handle)).toMatchObject({
    state: "running",
    cancellation: { requested: false, acknowledgement: "none" },
  });
});

test.each([
  ["é", 1],
  ["€", 1],
  ["€", 2],
  ["😀", 1],
  ["😀", 2],
  ["😀", 3],
] as const)(
  "growing UTF-8 character %s at byte %i has no loss or duplicate",
  async (character, split) => {
    const f = await fixture();
    f.state.stdout = Buffer.from(character).subarray(0, split);
    f.state.stderr = Buffer.alloc(0);
    const first = await f.read();
    expect(first.entries).toEqual([]);
    f.state.stdout = Buffer.from(character);
    f.state.done = true;
    const last = await f.read(first.nextCursor);
    expect(last.entries).toEqual([{ stream: "stdout", text: character }]);
    expect(last.truncated).toBe(false);
  },
);

test("a failed second stream publishes neither first-stream bytes nor offsets", async () => {
  const f = await fixture();
  f.state.failStream = "stderr";
  await f.client().syncLogs(handle);
  expect(await f.client().get(handle)).toMatchObject({
    outputBytes: 0,
    logErrorCode: "unknown_outcome",
  });
  f.state.failStream = "";
  await f.client().syncLogs(handle);
  expect(
    (await f.client().logs({ ...handle, cursor: null })).entries
      .map((e) => e.text)
      .join(""),
  ).toBe("hellowarning");
  expect(
    f.calls
      .filter((c) => c.url.searchParams.get("stream") === "stdout")
      .map((c) => c.url.searchParams.get("offset")),
  ).toEqual(["0", "0"]);
});

test("BOM characters are preserved at stream and page starts", async () => {
  const f = await fixture();
  f.state.stdout = Buffer.from(`\ufeff${"x".repeat(1021)}\ufeff`);
  f.state.stderr = Buffer.alloc(0);
  f.state.done = true;
  const first = await f.read();
  const next = await f.read(first.nextCursor);
  expect([...first.entries, ...next.entries].map((e) => e.text).join("")).toBe(
    `\ufeff${"x".repeat(1021)}\ufeff`,
  );
});
