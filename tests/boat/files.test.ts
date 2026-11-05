import { convexTest } from "convex-test";
import { defineSchema } from "convex/server";
import { expect, test } from "vitest";
import {
  register,
  createTestStores,
} from "@fantastic.dev/convex-sandbox/testing";
import { SandboxProviders } from "@fantastic.dev/convex-sandbox";
import { createBoatProvider } from "@fantastic.dev/convex-sandbox/boat";

const sandbox = { scope: "boat-file-fixture", key: "machine" };
const path = "/tmp/project/file.bin";
const context = () => ({
  idempotencyKey: "synthetic-file-operation",
  signal: new AbortController().signal,
});
async function fixture(policyRoot = "/tmp/project") {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const state = {
    data: Buffer.from([0, 255, 1, 10]),
    corrupt: "",
    truncated: false,
    deny: "",
    lost: false,
    relativeReadWrite: false,
    echo: undefined as unknown,
    files: [
      { name: "file.bin", path, isDir: false, isSymlink: false, size: 4 },
      {
        name: "link",
        path: "/tmp/project/link",
        isDir: true,
        isSymlink: true,
        size: 1,
      },
    ],
  };
  const provider = createBoatProvider({
    apiKey: "synthetic-files-key",
    fetch: async (url, init = {}) => {
      const u = new URL(String(url));
      calls.push({ url: u, init });
      if (state.lost) throw new Error("synthetic-private-error");
      const requestedPath =
        init.method === "PUT"
          ? JSON.parse(String(init.body)).path
          : u.searchParams.get("path");
      let reply: Record<string, unknown> = {
        ok: true,
        success: true,
        path: requestedPath,
      };
      if (u.pathname.endsWith("/list"))
        reply = { ...reply, files: state.files, truncated: state.truncated };
      else if (init.method === "PUT") {
        const body = JSON.parse(String(init.body));
        state.data = Buffer.from(body.content, "base64");
        reply = { ...reply, encoding: "base64", size: state.data.length };
      } else if (init.method !== "DELETE")
        reply = {
          ...reply,
          encoding: "base64",
          size: state.data.length,
          content: state.data.toString("base64"),
        };
      if (
        state.relativeReadWrite &&
        !u.pathname.endsWith("/list") &&
        init.method !== "DELETE" &&
        typeof requestedPath === "string"
      ) {
        reply.path = requestedPath.startsWith("/tmp/")
          ? `../..${requestedPath}`
          : requestedPath.slice("/home/user/".length);
      }
      if (state.echo !== undefined) reply.path = state.echo;
      if (state.corrupt === "path") reply.path = "/tmp/foreign";
      if (state.corrupt === "size") reply.size = state.data.length + 1;
      if (state.corrupt === "encoding") reply.encoding = "utf8";
      if (state.corrupt === "base64") reply.content = "!!!!";
      if (state.corrupt === "success") reply.success = false;
      return new Response(JSON.stringify(reply));
    },
  });
  const t = convexTest(defineSchema({}), {
    "./_generated/server.js": () =>
      import("../../example/convex/_generated/server.js"),
  });
  const c = register(t),
    stores = createTestStores(
      t,
      c,
      ({ path: requested }) =>
        (requested === policyRoot || requested.startsWith(`${policyRoot}/`)) &&
        requested !== state.deny,
    );
  await t.mutation(c.registry.ensure, {
    sandbox,
    reference: { provider: "boat", providerId: "file-vm" },
  });
  const providers = new SandboxProviders({ authorize: async () => {} });
  providers.register(provider);
  const client = providers.files(stores.files);
  return { state, calls, provider, client, stores };
}

test("native base64 read/write preserve binary bytes, and offsets slice a bounded whole-file reply", async () => {
  const f = await fixture();
  const first = await f.client.read({ sandbox, path, maxBytes: 2 });
  expect([...new Uint8Array(first.data)]).toEqual([0, 255]);
  expect(first).toMatchObject({
    offset: 0,
    bytesRead: 2,
    totalBytes: 4,
    truncated: true,
    nextOffset: 2,
  });
  const last = await f.client.read({ sandbox, path, offset: 2, maxBytes: 2 });
  expect([...new Uint8Array(last.data)]).toEqual([1, 10]);
  expect(last).toMatchObject({ truncated: false, nextOffset: null });
  const bytes = new Uint8Array([255, 0, 128]).buffer;
  expect(
    await f.client.write({ sandbox, path, operationId: "write", data: bytes }),
  ).toEqual({ bytesWritten: 3, partial: false });
  expect(JSON.parse(String(f.calls[2].init.body))).toEqual({
    path,
    encoding: "base64",
    content: "/wCA",
  });
  expect(f.calls[0].url.searchParams.get("encoding")).toBe("base64");
  expect(f.calls[1].url.searchParams.has("offset")).toBe(false);
});

test("UTF-8 and BOM bytes keep shared partial-read semantics", async () => {
  const f = await fixture();
  f.state.data = Buffer.from("\ufeffa😀z");
  const first = await f.client.readText({ sandbox, path, maxBytes: 6 });
  expect(first).toMatchObject({
    text: "\ufeffa",
    bytesRead: 4,
    nextOffset: 4,
    truncated: true,
  });
  expect(await f.client.readText({ sandbox, path, offset: 4 })).toMatchObject({
    text: "😀z",
    bytesRead: 5,
    truncated: false,
  });
});

test.each(["read", "write", "list", "delete"] as const)(
  "host path policy denies %s before native dispatch",
  async (operation) => {
    const f = await fixture();
    f.state.deny = path;
    const requests = {
      read: () => f.client.read({ sandbox, path }),
      write: () =>
        f.client.write({
          sandbox,
          path,
          operationId: "denied",
          data: new ArrayBuffer(0),
        }),
      list: () => f.client.list({ sandbox, path }),
      delete: () => f.client.delete({ sandbox, path, operationId: "denied" }),
    };
    await expect(requests[operation]()).rejects.toMatchObject({
      data: { code: "authorization", outcome: "not_started" },
    });
    expect(f.calls).toHaveLength(0);
  },
);

test("64 KiB adapter inline bound rejects oversized writes before dispatch and whole-file reads safely", async () => {
  const f = await fixture();
  await expect(
    f.client.write({
      sandbox,
      path,
      operationId: "large",
      data: new ArrayBuffer(65537),
    }),
  ).rejects.toThrow("File limit exceeded");
  expect(f.calls).toHaveLength(0);
  f.state.data = Buffer.alloc(65537);
  await expect(f.client.read({ sandbox, path })).rejects.toMatchObject({
    data: { code: "validation" },
  });
  expect(f.calls).toHaveLength(1);
});

test.each(["path", "size", "encoding", "base64", "success"])(
  "malformed native read fails without raw response leakage: %s",
  async (corrupt) => {
    const f = await fixture();
    f.state.corrupt = corrupt;
    await expect(f.client.read({ sandbox, path })).rejects.toMatchObject({
      data: { code: "validation" },
    });
  },
);

test("list is bounded and explicitly partial without invented pagination; child policy and symlink kind are preserved", async () => {
  const f = await fixture();
  const list = await f.client.list({ sandbox, path: "/tmp/project", limit: 1 });
  expect(list).toMatchObject({ nextCursor: null, partial: true });
  expect(list.entries).toHaveLength(1);
  const count = f.calls.length;
  await expect(
    f.client.list({ sandbox, path: "/tmp/project", cursor: "invented" }),
  ).rejects.toMatchObject({
    data: { code: "unsupported", outcome: "not_started" },
  });
  expect(f.calls).toHaveLength(count);
  f.state.deny = path;
  expect(await f.client.list({ sandbox, path: "/tmp/project" })).toEqual({
    entries: [
      {
        name: "link",
        path: "/tmp/project/link",
        kind: "symlink",
        sizeBytes: 1,
      },
    ],
    nextCursor: null,
    partial: true,
  });
  f.state.deny = "";
  f.state.truncated = true;
  expect((await f.client.list({ sandbox, path: "/tmp/project" })).partial).toBe(
    true,
  );
});

test("foreign directory entry paths cannot be projected as authorized children", async () => {
  const f = await fixture();
  f.state.files[0].path = "/tmp/foreign";
  await expect(
    f.client.list({ sandbox, path: "/tmp/project" }),
  ).rejects.toMatchObject({ data: { code: "validation" } });
});

test("delete is native, nonrecursive and confirmed only by a matching successful reply", async () => {
  const f = await fixture();
  expect(
    await f.client.delete({ sandbox, path, operationId: "delete" }),
  ).toEqual({ deleted: true });
  expect(f.calls[0].init.method).toBe("DELETE");
  expect(f.calls[0].url.searchParams.get("recursive")).toBe("false");
  f.state.corrupt = "path";
  await expect(
    f.client.delete({ sandbox, path, operationId: "foreign" }),
  ).rejects.toMatchObject({ data: { code: "validation", outcome: "unknown" } });
});

test.each(["download", "upload"] as const)(
  "unbounded native %s URLs are unsupported before minting",
  async (direction) => {
    const f = await fixture();
    await expect(
      f.client.transfer({ sandbox, path, direction, operationId: "transfer" }),
    ).rejects.toMatchObject({
      data: { code: "unsupported", capability: "transferFile" },
    });
    expect(f.calls).toHaveLength(0);
    expect(f.provider.adapter.files?.transfer).toBeUndefined();
  },
);

test("lost native write is unknown and never automatically replayed", async () => {
  const f = await fixture();
  f.state.lost = true;
  await expect(
    f.client.write({
      sandbox,
      path,
      operationId: "lost",
      data: new ArrayBuffer(1),
    }),
  ).rejects.toMatchObject({
    data: { code: "unknown_outcome", outcome: "unknown" },
  });
  expect(f.calls).toHaveLength(1);
});

test("provider roots and canonical path syntax are enforced even through the low-level adapter", async () => {
  const f = await fixture();
  const read = f.provider.adapter.files?.read;
  if (!read) throw new Error("Missing native file adapter");
  for (const denied of [
    "/etc/passwd",
    "/tmp/../etc",
    "/tmp/%2e%2e/secret",
    "relative",
    "../../tmp/project/file.bin",
    "/tmp/a\\b",
  ])
    await expect(
      read("file-vm", denied, { offset: 0, maxBytes: 4 }, context()),
    ).rejects.toMatchObject({ data: { outcome: "not_started" } });
  expect(f.calls).toHaveLength(0);
});

test.each(["/tmp/project", "/home/user/project"])(
  "read/write accept only the exact workdir-relative echo for %s without changing requests",
  async (root) => {
    const f = await fixture(root),
      requested = `${root}/file.bin`;
    f.state.relativeReadWrite = true;
    const read = await f.client.read({ sandbox, path: requested });
    expect([...new Uint8Array(read.data)]).toEqual([0, 255, 1, 10]);
    expect(
      await f.client.write({
        sandbox,
        path: requested,
        operationId: "relative-write",
        data: new Uint8Array([1, 2]).buffer,
      }),
    ).toEqual({ bytesWritten: 2, partial: false });
    expect(f.calls[0].url.searchParams.get("path")).toBe(requested);
    expect(JSON.parse(String(f.calls[1].init.body)).path).toBe(requested);
  },
);

test.each([
  ["/tmp/project", "tmp/project/file.bin"],
  ["/tmp/project", "../../../tmp/project/file.bin"],
  ["/tmp/project", "../../tmp/project/other.bin"],
  ["/tmp/project", "../../tmp/project/../project/file.bin"],
  ["/tmp/project", "../../tmp/project/%2e%2e/file.bin"],
  ["/tmp/project", "/tmp/project/../project/file.bin"],
  ["/tmp/project", "https://example.invalid/file.bin"],
  ["/tmp/project", "..\\..\\tmp\\project\\file.bin"],
  ["/home/user/project", "../../tmp/project/file.bin"],
  ["/home/user/project", "../user/project/file.bin"],
])(
  "foreign or noncanonical file echo is rejected: %s / %s",
  async (root, echo) => {
    const f = await fixture(root),
      requested = `${root}/file.bin`;
    f.state.echo = echo;
    await expect(
      f.client.read({ sandbox, path: requested }),
    ).rejects.toMatchObject({ data: { code: "validation" } });
    await expect(
      f.client.write({
        sandbox,
        path: requested,
        operationId: "wrong-echo",
        data: new ArrayBuffer(0),
      }),
    ).rejects.toMatchObject({
      data: { code: "validation", outcome: "unknown" },
    });
    expect(f.calls).toHaveLength(2);
  },
);

test("list and delete keep their absolute echo requirement", async () => {
  const f = await fixture();
  f.state.echo = "../../tmp/project";
  await expect(
    f.client.list({ sandbox, path: "/tmp/project" }),
  ).rejects.toMatchObject({ data: { code: "validation" } });
  f.state.echo = "../../tmp/project/file.bin";
  await expect(
    f.client.delete({ sandbox, path, operationId: "relative-delete" }),
  ).rejects.toMatchObject({ data: { code: "validation", outcome: "unknown" } });
});
