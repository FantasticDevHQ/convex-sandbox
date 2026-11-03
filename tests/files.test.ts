import { expect, test, vi } from "vitest";
import {
  SandboxProviders,
  registerProvider,
  type FileAdapter,
  type FilePathPolicy,
  type RegistryRecord,
} from "@fantastic.dev/convex-sandbox";

const sandbox = { scope: "workspace-a", key: "machine" };
const row: RegistryRecord = {
  ...sandbox,
  reference: { provider: "fixture", providerId: "vm-1" },
  generation: 1,
  version: 1,
  observedState: "running",
  tombstone: false,
  refreshSequence: 1,
  observedSequence: 1,
  refresh: { status: "fresh" },
  updatedAt: 1,
};
const encode = (value: string) => new TextEncoder().encode(value).buffer;
function fixture(
  overrides: Partial<FileAdapter> = {},
  policy: FilePathPolicy = async ({ path }) =>
    path === "/workspace" || path.startsWith("/workspace/"),
) {
  let current: RegistryRecord | null = structuredClone(row);
  const files = new Map<string, ArrayBuffer>();
  const adapter: FileAdapter = {
    read: async (_, path, request) => {
      const value = files.get(path) ?? new ArrayBuffer(0);
      const end = Math.min(value.byteLength, request.offset + request.maxBytes);
      return {
        data: value.slice(request.offset, end),
        offset: request.offset,
        totalBytes: value.byteLength,
        complete: end === value.byteLength,
      };
    },
    write: async (_, path, data) => {
      files.set(path, data.slice(0));
      return { bytesWritten: data.byteLength, complete: true };
    },
    list: async () => ({
      entries: [{ name: "hello.txt", kind: "file", sizeBytes: 5 }],
      nextCursor: null,
      complete: true,
    }),
    delete: async (_, path) => ({ deleted: files.delete(path) }),
    transferDirections: ["download", "upload"],
    transfer: async (_, __, request) => ({
      url: "https://files.example.test/private?token=synthetic",
      method: request.direction === "download" ? "GET" : "PUT",
      expiresAt: Date.now() + request.expiresInMs - 100,
      maxBytes: request.maxBytes,
      partial: false,
    }),
    ...overrides,
  };
  const providers = new SandboxProviders({ authorize: async () => {} });
  providers.register(
    registerProvider({
      name: "fixture",
      adapter: {
        describe: async (providerId) => ({ providerId, state: "running" }),
        files: adapter,
      },
      capabilities: {
        version: 1,
        supported: [
          "describe",
          "readFile",
          "writeFile",
          "listFiles",
          "deleteFile",
          "transferFile",
        ],
        limits: { maxFileBytes: 1048576 },
      },
    }),
  );
  const client = providers.files({
    getSandbox: async (identity) =>
      identity.scope === sandbox.scope ? current : null,
    authorizePath: policy,
  });
  return {
    client,
    files,
    providers,
    setRow: (value: RegistryRecord | null) => {
      current = value;
    },
  };
}

test("text and binary round trips preserve contents through public exports", async () => {
  const f = fixture();
  expect(
    await f.client.writeText({
      sandbox,
      path: "/workspace/text",
      text: "Hello 🦊\n",
      operationId: "text",
    }),
  ).toMatchObject({ partial: false });
  expect(
    await f.client.readText({ sandbox, path: "/workspace/text" }),
  ).toMatchObject({ text: "Hello 🦊\n", truncated: false });
  const data = new Uint8Array([0, 255, 128, 1]).buffer;
  await f.client.write({
    sandbox,
    path: "/workspace/binary",
    data,
    operationId: "binary",
  });
  expect(
    new Uint8Array(
      (await f.client.read({ sandbox, path: "/workspace/binary" })).data,
    ),
  ).toEqual(new Uint8Array(data));
  expect(
    await f.client.delete({
      sandbox,
      path: "/workspace/binary",
      operationId: "delete",
    }),
  ).toEqual({ deleted: true });
});

test.each([
  "/workspace/../secret",
  "/workspace/./secret",
  "/workspace\\..\\secret",
  "/workspace/%2e%2e/secret",
  "relative",
  "/workspace/\0bad",
])("invalid paths never reach the SDK: %s", async (path) => {
  let calls = 0;
  const f = fixture({
    read: async () => {
      calls++;
      throw new Error("must not run");
    },
  });
  await expect(f.client.read({ sandbox, path })).rejects.toThrow(
    "Invalid file path",
  );
  expect(calls).toBe(0);
});

test("path policy denies requests and filters unauthorized child entries", async () => {
  let reads = 0;
  const f = fixture(
    {
      read: async () => {
        reads++;
        return { data: encode("private"), offset: 0, complete: true };
      },
      list: async () => ({
        entries: [
          { name: "allowed", kind: "file" },
          { name: "private", kind: "file" },
        ],
        nextCursor: "next-page",
        complete: false,
      }),
    },
    async ({ path }) =>
      path.startsWith("/workspace") && !path.endsWith("private"),
  );
  await expect(
    f.client.read({ sandbox, path: "/workspace/private" }),
  ).rejects.toMatchObject({ data: { code: "authorization" } });
  expect(reads).toBe(0);
  const listing = await f.client.list({
    sandbox,
    path: "/workspace",
    limit: 2,
  });
  expect(listing.entries.map((entry) => entry.name)).toEqual(["allowed"]);
  expect(listing).toMatchObject({ partial: true, nextCursor: "next-page" });
});

test("read bounds, UTF-8 boundaries and partial writes are explicit", async () => {
  const f = fixture({
    write: async () => ({ bytesWritten: 2, complete: false }),
  });
  f.files.set("/workspace/text", encode("a🦊z"));
  expect(
    await f.client.read({ sandbox, path: "/workspace/text", maxBytes: 3 }),
  ).toMatchObject({ bytesRead: 3, truncated: true, nextOffset: 3 });
  expect(
    await f.client.readText({ sandbox, path: "/workspace/text", maxBytes: 3 }),
  ).toMatchObject({ text: "a", bytesRead: 1, truncated: true, nextOffset: 1 });
  expect(
    await f.client.write({
      sandbox,
      path: "/workspace/out",
      data: encode("larger"),
      operationId: "write",
    }),
  ).toEqual({ bytesWritten: 2, partial: true });
});

test("oversized writes fail before SDK work and oversized read replies are clipped", async () => {
  let writes = 0;
  const f = fixture({
    write: async () => {
      writes++;
      return { bytesWritten: 0, complete: false };
    },
    read: async () => ({
      data: new Uint8Array(100).buffer,
      offset: 0,
      totalBytes: 100,
      complete: true,
    }),
  });
  await expect(
    f.client.write({
      sandbox,
      path: "/workspace/out",
      data: new ArrayBuffer(1048577),
      operationId: "large",
    }),
  ).rejects.toThrow("File limit exceeded");
  expect(writes).toBe(0);
  const read = await f.client.read({
    sandbox,
    path: "/workspace/in",
    maxBytes: 8,
  });
  expect(read.data.byteLength).toBe(8);
  expect(read.truncated).toBe(true);
});

test("transfer handles are bounded, ephemeral and absent from listing metadata", async () => {
  const f = fixture();
  const transfer = await f.client.transfer({
    sandbox,
    path: "/workspace/file",
    direction: "download",
    operationId: "download",
    expiresInMs: 10000,
    maxBytes: 1024,
  });
  expect(transfer).toMatchObject({
    method: "GET",
    maxBytes: 1024,
    partial: false,
  });
  expect(transfer.expiresAt).toBeLessThanOrEqual(Date.now() + 10000);
  expect(
    JSON.stringify(await f.client.list({ sandbox, path: "/workspace" })),
  ).not.toContain("synthetic");
  const g = fixture({
    transfer: async () => ({
      url: "https://files.example.test/signed",
      method: "GET",
      expiresAt: Date.now() + 3600000,
      maxBytes: 1024,
      partial: false,
    }),
  });
  await expect(
    g.client.transfer({
      sandbox,
      path: "/workspace/file",
      direction: "download",
      operationId: "bad-expiry",
    }),
  ).rejects.toThrow("Invalid transfer handle");
});

test("unsupported transfer directions fail before the adapter is invoked", async () => {
  let calls = 0;
  const f = fixture({
    transferDirections: ["download"],
    transfer: async () => {
      calls++;
      throw new Error("must not run");
    },
  });
  await expect(
    f.client.transfer({
      sandbox,
      path: "/workspace/file",
      direction: "upload",
      operationId: "unsupported",
    }),
  ).rejects.toMatchObject({ data: { code: "unsupported" } });
  expect(calls).toBe(0);
});

test("identity and binary input are snapshotted while path authorization awaits", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = fixture({}, async () => {
    await gate;
    return true;
  });
  const identity = { ...sandbox },
    data = new Uint8Array([1, 2, 3]);
  const call = f.client.write({
    sandbox: identity,
    path: "/workspace/data",
    data: data.buffer,
    operationId: "snapshot",
  });
  identity.scope = "foreign";
  data[0] = 99;
  release();
  expect(await call).toMatchObject({ bytesWritten: 3, partial: false });
  expect(
    new Uint8Array(f.files.get("/workspace/data") ?? new ArrayBuffer(0)),
  ).toEqual(new Uint8Array([1, 2, 3]));
});

test("missing SDK methods and host authorization fail before native file work", async () => {
  const f = fixture({ read: undefined });
  await expect(
    f.client.read({ sandbox, path: "/workspace/file" }),
  ).rejects.toMatchObject({
    data: { code: "unsupported", outcome: "not_started" },
  });
  const providers = new SandboxProviders({
    authorize: async () => {
      throw new Error("Denied by host");
    },
  });
  let calls = 0;
  providers.register(
    registerProvider({
      name: "fixture",
      adapter: {
        describe: async (providerId) => ({ providerId, state: "running" }),
        files: {
          read: async () => {
            calls++;
            throw new Error("must not run");
          },
        },
      },
      capabilities: { version: 1, supported: ["readFile"] },
    }),
  );
  await expect(
    providers
      .files({ getSandbox: async () => row, authorizePath: async () => true })
      .read({ sandbox, path: "/workspace/file" }),
  ).rejects.toThrow("Denied by host");
  expect(calls).toBe(0);
});

test("generation changes during authorization or SDK work fence stale results", async () => {
  let calls = 0;
  const before = fixture(
    {
      read: async () => {
        calls++;
        throw new Error("must not run");
      },
    },
    async () => {
      before.setRow({ ...row, generation: 2 });
      return true;
    },
  );
  await expect(
    before.client.read({ sandbox, path: "/workspace/file" }),
  ).rejects.toMatchObject({
    data: { code: "stale_resource", outcome: "not_started" },
  });
  expect(calls).toBe(0);
  const after = fixture({
    write: async () => {
      calls++;
      after.setRow(null);
      return { bytesWritten: 1, complete: true };
    },
  });
  await expect(
    after.client.write({
      sandbox,
      path: "/workspace/file",
      data: new ArrayBuffer(1),
      operationId: "stale",
    }),
  ).rejects.toMatchObject({
    data: { code: "stale_resource", outcome: "unknown" },
  });
  expect(calls).toBe(1);
});

test("typed-array read views are copied without surrounding buffer data", async () => {
  const raw = new Uint8Array([99, 1, 2, 88]);
  const f = fixture({
    read: async () => ({ data: raw.subarray(1, 3), offset: 0, complete: true }),
  });
  const response = await f.client.read({ sandbox, path: "/workspace/file" });
  raw[1] = 77;
  expect([...new Uint8Array(response.data)]).toEqual([1, 2]);
});

test("raw SDK failures are sanitized and mutations are never automatically retried", async () => {
  let calls = 0;
  const f = fixture({
    delete: async () => {
      calls++;
      throw new Error("signed-url-secret");
    },
  });
  await expect(
    f.client.delete({
      sandbox,
      path: "/workspace/file",
      operationId: "delete",
    }),
  ).rejects.toMatchObject({
    message: "Provider outcome is unknown",
    data: { code: "unknown_outcome", retryable: false },
  });
  expect(calls).toBe(1);
});

test.each([
  { url: "http://files.example.test/secret" },
  { url: "https://files.example.test/secret\n" },
  { headers: { Authorization: "bad\vheader" } },
  { headers: { Authorization: "🦊".repeat(5000) } },
  { url: "https://user:password@files.example.test/secret" },
  { maxBytes: 2048 },
  { headers: { Authorization: "bad\r\nheader" } },
  { method: "PUT" as const },
])(
  "invalid native transfer metadata is rejected (case %#)",
  async (override) => {
    const f = fixture({
      transfer: async () => ({
        url: "https://files.example.test/signed",
        method: "GET",
        expiresAt: Date.now() + 1000,
        maxBytes: 1024,
        partial: false,
        ...override,
      }),
    });
    await expect(
      f.client.transfer({
        sandbox,
        path: "/workspace/file",
        direction: "download",
        operationId: "invalid",
        maxBytes: 1024,
      }),
    ).rejects.toThrow("Invalid transfer handle");
  },
);

test("invalid UTF-8 and non-progress text reads are explicit failures", async () => {
  const f = fixture();
  f.files.set("/workspace/invalid", new Uint8Array([255]).buffer);
  await expect(
    f.client.readText({ sandbox, path: "/workspace/invalid" }),
  ).rejects.toThrow("Invalid UTF-8 file");
  f.files.set("/workspace/fox", encode("🦊"));
  await expect(
    f.client.readText({ sandbox, path: "/workspace/fox", maxBytes: 1 }),
  ).rejects.toThrow("Text read limit cannot contain the next UTF-8 character");
});

test("native file deadlines abort and report unknown outcomes without retry", async () => {
  vi.useFakeTimers();
  try {
    let calls = 0;
    let signal: AbortSignal | undefined;
    const f = fixture({
      write: async (_, __, ___, context) => {
        calls++;
        signal = context.signal;
        return new Promise(() => {});
      },
    });
    const result = f.client.write({
      sandbox,
      path: "/workspace/file",
      data: new ArrayBuffer(1),
      operationId: "timeout",
    });
    const failed = expect(result).rejects.toMatchObject({
      data: { code: "timeout", outcome: "unknown", retryable: false },
    });
    await vi.advanceTimersByTimeAsync(5001);
    await failed;
    expect(calls).toBe(1);
    expect(signal?.aborted).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

test("provider byte limits, missing path policy and unsafe listing names are rejected", async () => {
  const f = fixture({
    list: async () => ({
      entries: [{ name: "../secret", kind: "symlink" }],
      nextCursor: null,
      complete: true,
    }),
  });
  await expect(f.client.list({ sandbox, path: "/workspace" })).rejects.toThrow(
    "Invalid file listing",
  );
  expect(() =>
    f.providers.files({
      getSandbox: async () => row,
      authorizePath: undefined as unknown as FilePathPolicy,
    }),
  ).toThrow("File path policy required");
  f.providers.register(
    registerProvider({
      name: "small",
      adapter: {
        describe: async (providerId) => ({ providerId, state: "running" }),
        files: {
          read: async () => {
            throw new Error("must not run");
          },
        },
      },
      capabilities: {
        version: 1,
        supported: ["readFile"],
        limits: { maxFileBytes: 2 },
      },
    }),
  );
  f.setRow({
    ...row,
    reference: { provider: "small", providerId: "small-vm" },
  });
  await expect(
    f.client.read({ sandbox, path: "/workspace/file", maxBytes: 3 }),
  ).rejects.toThrow("File limit exceeded");
});

test("upload and download transfer keys cannot collide under a shared operation ID", async () => {
  const keys: string[] = [];
  const f = fixture({
    transfer: async (_, __, request, context) => {
      keys.push(context.idempotencyKey);
      return {
        url: "https://files.example.test/signed",
        method: request.direction === "upload" ? "PUT" : "GET",
        expiresAt: Date.now() + 1000,
        maxBytes: request.maxBytes,
        partial: false,
      };
    },
  });
  for (const direction of ["upload", "download"] as const)
    await f.client.transfer({
      sandbox,
      path: "/workspace/file",
      direction,
      operationId: "shared",
    });
  expect(new Set(keys).size).toBe(2);
});
