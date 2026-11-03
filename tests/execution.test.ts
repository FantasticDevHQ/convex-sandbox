import { convexTest } from "convex-test";
import { defineSchema } from "convex/server";
import { expect, test, vi } from "vitest";
import { register } from "@fantastic.dev/convex-sandbox/testing";
import {
  SandboxProviders,
  registerProvider,
  SandboxProviderError,
  type ExecutionAdapter,
  type ExecutionStore,
} from "@fantastic.dev/convex-sandbox";

const sandbox = { scope: "scope-a", key: "machine" };
const handle = { sandbox, operationId: "command" };
const input = {
  kind: "argv" as const,
  executable: "printf",
  args: ["hello"],
  cwd: "/workspace",
  timeoutMs: 60000,
};
function fixture(sdk: ExecutionAdapter) {
  const t = convexTest(defineSchema({}), {
    "./_generated/server.js": () =>
      import("../example/convex/_generated/server.js"),
  });
  const c = register(t);
  const store: ExecutionStore = {
    getSandbox: (sandbox) => t.query(c.registry.get, { sandbox }),
    get: (handle) => t.query(c.execution.get, handle),
    reserve: (args) => t.mutation(c.execution.reserve, args),
    claim: (args) => t.mutation(c.execution.claim, args),
    publish: (args) => t.mutation(c.execution.publish, args),
    requestCancel: (args) => t.mutation(c.execution.requestCancel, args),
    acknowledgeCancel: (args) =>
      t.mutation(c.execution.acknowledgeCancel, args),
    claimLogs: (args) => t.mutation(c.execution.claimLogs, args),
    appendLogs: (args) => t.mutation(c.execution.appendLogs, args),
    logs: (args) => t.query(c.execution.logs, args),
  };
  const providers = new SandboxProviders({ authorize: async () => {} });
  providers.register(
    registerProvider({
      name: "fixture",
      adapter: {
        describe: async (providerId) => ({ providerId, state: "running" }),
        execution: sdk,
      },
      capabilities: {
        version: 1,
        supported: ["describe", "execute", "cancelExecution", "executionLogs"],
      },
    }),
  );
  return {
    t,
    c,
    store,
    client: providers.execution(store),
    setup: () =>
      t.mutation(c.registry.ensure, {
        sandbox,
        reference: { provider: "fixture", providerId: "vm-1" },
      }),
  };
}
function adapter(overrides: Partial<ExecutionAdapter> = {}): ExecutionAdapter {
  return {
    idempotency: "none",
    start: async () => ({ executionId: "exec-1", state: "queued" }),
    status: async () => ({ executionId: "exec-1", state: "running" }),
    cancel: async () => ({ acknowledged: true }),
    logs: async () => ({ entries: [], nextCursor: null, complete: true }),
    ...overrides,
  };
}

test("queued start returns a handle and duplicate action IDs never dispatch twice", async () => {
  let calls = 0;
  const f = fixture(
    adapter({
      start: async (_, received) => {
        calls++;
        expect(received).toEqual(input);
        return { executionId: "exec-1", state: "queued" };
      },
    }),
  );
  await f.setup();
  await Promise.all([
    f.client.start({ ...handle, input }),
    f.client.start({ ...handle, input }),
  ]);
  expect(calls).toBe(1);
  expect(await f.client.get(handle)).toMatchObject({
    operationId: "command",
    executionId: "exec-1",
    state: "queued",
  });
  expect(await f.client.status(handle)).toMatchObject({ state: "running" });
});

test("completed command exposes exit code and bounded stdout/stderr with truncation markers", async () => {
  const f = fixture(
    adapter({
      start: async () => ({
        executionId: "exec-1",
        state: "completed",
        exitCode: 7,
        output: {
          stdout: "🦊".repeat(10000),
          stderr: "failure",
          truncated: false,
        },
      }),
    }),
  );
  await f.setup();
  const record = await f.client.start({ ...handle, input });
  expect(record).toMatchObject({
    state: "completed",
    exitCode: 7,
    outputTruncated: true,
  });
  const logs = await f.client.logs({ ...handle, cursor: null, limit: 16 });
  expect(
    logs.entries.some(
      (entry) => entry.stream === "stderr" && entry.text === "failure",
    ),
  ).toBe(true);
  expect(
    logs.entries.reduce(
      (size, entry) => size + new TextEncoder().encode(entry.text).length,
      0,
    ),
  ).toBeLessThanOrEqual(8192);
  expect(
    logs.entries.every(
      (entry) => new TextEncoder().encode(entry.text).length <= 4096,
    ),
  ).toBe(true);
});

test("failed start and unknown start outcomes remain distinct without re-execution", async () => {
  let calls = 0;
  const f = fixture(
    adapter({
      start: async () => {
        calls++;
        throw new SandboxProviderError({
          code: "capacity",
          outcome: "not_started",
          retryable: true,
        });
      },
    }),
  );
  await f.setup();
  expect(await f.client.start({ ...handle, input })).toMatchObject({
    state: "failed",
    errorCode: "capacity",
  });
  await f.client.start({ ...handle, input });
  expect(calls).toBe(1);
  const g = fixture(
    adapter({
      start: async () => {
        throw new Error("lost private reply");
      },
    }),
  );
  await g.setup();
  expect(await g.client.start({ ...handle, input })).toMatchObject({
    state: "unknown",
  });
  expect(await g.client.status(handle)).toMatchObject({ state: "unknown" });
});

test("bounded waiting leaves a long process running and never starts it again", async () => {
  let starts = 0;
  let reads = 0;
  const f = fixture(
    adapter({
      start: async () => {
        starts++;
        return { executionId: "exec-1", state: "running" };
      },
      status: async () => {
        reads++;
        return { executionId: "exec-1", state: "running" };
      },
    }),
  );
  await f.setup();
  await f.client.start({ ...handle, input });
  expect(
    await f.client.wait({
      ...handle,
      maxPolls: 2,
      maxWaitMs: 1000,
      wait: async () => {},
    }),
  ).toMatchObject({ state: "running" });
  expect(reads).toBe(2);
  expect(starts).toBe(1);
});

test("cancel request and provider acknowledgement do not invent a cancelled process", async () => {
  const f = fixture(adapter());
  await f.setup();
  await f.client.start({ ...handle, input });
  expect(await f.client.cancel(handle)).toMatchObject({
    state: "queued",
    cancellation: { requested: true, acknowledgement: "accepted" },
  });
  expect(await f.client.status(handle)).toMatchObject({ state: "running" });
});

test("completion wins a cancellation race without losing cancellation acknowledgement", async () => {
  let release: (value: { acknowledged: boolean }) => void = () => {};
  const response = new Promise<{ acknowledged: boolean }>((resolve) => {
    release = resolve;
  });
  const f = fixture(
    adapter({
      cancel: async () => response,
      status: async () => ({
        executionId: "exec-1",
        state: "completed",
        exitCode: 0,
      }),
    }),
  );
  await f.setup();
  await f.client.start({ ...handle, input });
  const cancellation = f.client.cancel(handle);
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
    if ((await f.store.get(handle))?.cancellation.requested) break;
  }
  await f.client.status(handle);
  release({ acknowledged: true });
  await cancellation;
  expect(await f.client.get(handle)).toMatchObject({
    state: "completed",
    exitCode: 0,
    cancellation: { requested: true, acknowledgement: "accepted" },
  });
});

test("provider log pages are cached once, bounded, cursor-paginated and scoped", async () => {
  let pages = 0;
  const f = fixture(
    adapter({
      logs: async (_, __, request) => {
        pages++;
        return {
          entries: Array.from({ length: 16 }, (_, i) => ({
            stream: "stdout" as const,
            text: `${request.cursor ?? "first"}-${i}:${"x".repeat(4000)}`,
          })),
          nextCursor: `page-${pages}`,
          complete: pages >= 10,
        };
      },
    }),
  );
  await f.setup();
  await f.client.start({ ...handle, input });
  for (let i = 0; i < 10; i++) await f.client.syncLogs(handle);
  const record = await f.client.get(handle);
  expect(record?.outputBytes).toBeLessThanOrEqual(65536);
  expect(record?.outputTruncated).toBe(true);
  const first = await f.client.logs({ ...handle, cursor: null, limit: 2 });
  const second = await f.client.logs({
    ...handle,
    cursor: first.nextCursor,
    limit: 2,
  });
  expect(first.entries).toHaveLength(2);
  expect(second.entries[0]?.sequence).toBeGreaterThan(
    first.entries[1]?.sequence ?? -1,
  );
  const other = await f.store.logs({
    sandbox: { ...sandbox, scope: "scope-b" },
    operationId: "command",
    cursor: null,
    limit: 2,
  });
  expect(other.entries).toEqual([]);
});

test("a start deadline preserves an unknown command and ignores the late handle", async () => {
  let resolve: (value: {
    executionId: string;
    state: "running";
  }) => void = () => {};
  const late = new Promise<{ executionId: string; state: "running" }>(
    (done) => {
      resolve = done;
    },
  );
  const f = fixture(adapter({ start: async () => late }));
  await f.setup();
  vi.useFakeTimers();
  try {
    const call = f.client.start({ ...handle, input });
    await vi.advanceTimersByTimeAsync(5001);
    await call;
    expect(await f.store.get(handle)).toMatchObject({
      state: "unknown",
      errorCode: "timeout",
    });
    resolve({ executionId: "late", state: "running" });
    await Promise.resolve();
    expect((await f.store.get(handle))?.executionId).toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
});

test("invalid command input fails before any admission or SDK call", async () => {
  const f = fixture(adapter());
  await f.setup();
  await expect(
    f.client.start({
      ...handle,
      input: { kind: "shell", command: "echo\0bad" },
    }),
  ).rejects.toThrow("Invalid command");
  expect(await f.store.get(handle)).toBeNull();
});

test("sparse argv is rejected rather than dispatching undefined arguments", async () => {
  const f = fixture(adapter());
  await f.setup();
  const args: string[] = [];
  args.length = 1;
  await expect(
    f.client.start({ ...handle, input: { ...input, args } }),
  ).rejects.toThrow("Invalid command");
});

test("completed execution metadata and logs expire together with bounded operation history", async () => {
  const f = fixture(
    adapter({
      start: async () => ({
        executionId: "exec-1",
        state: "completed",
        exitCode: 0,
        output: { stdout: "synthetic output", stderr: "", truncated: false },
      }),
    }),
  );
  await f.setup();
  await f.client.start({ ...handle, input });
  for (let index = 0; index < 100; index++) {
    const row = await f.store.getSandbox(sandbox);
    const op = await f.t.mutation(f.c.operations.begin, {
      sandbox,
      expectedVersion: row?.version ?? -1,
      operationId: `later-${index}`,
      kind: "describe",
    });
    await f.t.mutation(f.c.operations.transition, {
      sandbox,
      operationId: op.operationId,
      expectedVersion: op.version,
      status: "succeeded",
    });
  }
  expect(await f.store.get(handle)).toBeNull();
  expect(
    (await f.store.logs({ ...handle, cursor: null, limit: 16 })).entries,
  ).toEqual([]);
});

test("lost start replies can recover an existing handle by lookup, without another start", async () => {
  let starts = 0;
  const f = fixture(
    adapter({
      start: async () => {
        starts++;
        throw new Error("lost");
      },
      find: async () => ({ executionId: "recovered", state: "running" }),
      status: async () => ({
        executionId: "recovered",
        state: "completed",
        exitCode: 0,
      }),
    }),
  );
  await f.setup();
  await f.client.start({ ...handle, input });
  expect(await f.client.status(handle)).toMatchObject({
    executionId: "recovered",
    state: "running",
  });
  expect(await f.client.status(handle)).toMatchObject({
    state: "completed",
    exitCode: 0,
  });
  expect(starts).toBe(1);
});

test("invalid short-wait options fail before command dispatch", async () => {
  const f = fixture(adapter());
  await f.setup();
  await expect(
    f.client.run({ ...handle, input, maxWaitMs: 999999 }),
  ).rejects.toThrow("Invalid short wait budget");
  expect(await f.store.get(handle)).toBeNull();
});

test("provider-confirmed cancellation releases work, while rejection does not", async () => {
  const f = fixture(
    adapter({
      status: async () => ({ executionId: "exec-1", state: "cancelled" }),
    }),
  );
  await f.setup();
  await f.client.start({ ...handle, input });
  await f.client.cancel(handle);
  expect(await f.client.status(handle)).toMatchObject({
    state: "cancelled",
    cancellation: { requested: true, acknowledgement: "accepted" },
  });
  expect(
    (await f.store.getSandbox(sandbox))?.activeOperationId,
  ).toBeUndefined();
  const g = fixture(adapter({ cancel: async () => ({ acknowledged: false }) }));
  await g.setup();
  await g.client.start({ ...handle, input });
  expect(await g.client.cancel(handle)).toMatchObject({
    state: "queued",
    cancellation: { requested: true, acknowledgement: "rejected" },
  });
  expect((await g.store.getSandbox(sandbox))?.activeOperationId).toBe(
    "command",
  );
});

test("short-wait execution retains its original identity while authorization is pending", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sdk = adapter({
    status: async () => ({
      executionId: "exec-1",
      state: "completed",
      exitCode: 0,
    }),
  });
  const f = fixture(sdk);
  await f.setup();
  const providers = new SandboxProviders({ authorize: async () => gate });
  providers.register(
    registerProvider({
      name: "fixture",
      adapter: {
        describe: async (providerId) => ({ providerId, state: "running" }),
        execution: sdk,
      },
      capabilities: { version: 1, supported: ["execute", "describe"] },
    }),
  );
  const mutable = {
    ...handle,
    sandbox: { ...sandbox },
    input,
    maxWaitMs: 1000,
  };
  const call = providers.execution(f.store).run(mutable);
  mutable.sandbox.scope = "scope-b";
  release();
  expect(await call).toMatchObject({ scope: "scope-a", state: "completed" });
});

test("late provider log pages cannot duplicate a terminal inline output snapshot", async () => {
  let release: (page: {
    entries: { stream: "stdout"; text: string }[];
    nextCursor: null;
    complete: boolean;
  }) => void = () => {};
  let entered: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const page = new Promise<{
    entries: { stream: "stdout"; text: string }[];
    nextCursor: null;
    complete: boolean;
  }>((resolve) => {
    release = resolve;
  });
  const f = fixture(
    adapter({
      logs: async () => {
        entered();
        return page;
      },
      status: async () => ({
        executionId: "exec-1",
        state: "completed",
        exitCode: 0,
        output: { stdout: "whole output", stderr: "", truncated: false },
      }),
    }),
  );
  await f.setup();
  await f.client.start({ ...handle, input });
  const pendingLogs = f.client.syncLogs(handle);
  await started;
  await f.client.status(handle);
  release({
    entries: [{ stream: "stdout", text: "duplicate output" }],
    nextCursor: null,
    complete: true,
  });
  await pendingLogs;
  expect(
    (await f.client.logs({ ...handle, cursor: null })).entries.map(
      (entry) => entry.text,
    ),
  ).toEqual(["whole output"]);
});
