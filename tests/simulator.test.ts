import { expect, test } from "vitest";
import { createSimulatedProvider } from "@fantastic.dev/convex-sandbox/testing";
import { SandboxProviders } from "@fantastic.dev/convex-sandbox";
const context = (key: string) => ({
  idempotencyKey: key,
  signal: new AbortController().signal,
});

test("simulated state is deterministic and survives a serialized fixture restart", async () => {
  const f = createSimulatedProvider({ profile: "persistent", now: () => 1000 });
  const sdk = f.provider.adapter;
  const machine = await sdk.create?.({}, context("create"));
  if (!machine || !sdk.files?.write)
    throw new Error("Missing fixture capability");
  await sdk.files.write(
    machine.providerId,
    "/workspace/a",
    new Uint8Array([0, 255, 1]).buffer,
    context("write"),
  );
  const state = f.snapshot();
  const restored = createSimulatedProvider({ state, now: () => 1000 });
  expect(restored.snapshot()).toEqual(state);
  expect(
    await restored.provider.adapter.findCreate?.("create", context("find")),
  ).toMatchObject({ providerId: machine.providerId });
  const data = await restored.provider.adapter.files?.read?.(
    machine.providerId,
    "/workspace/a",
    { offset: 0, maxBytes: 10 },
    context("read"),
  );
  expect(new Uint8Array(data?.data ?? new ArrayBuffer(0))).toEqual(
    new Uint8Array([0, 255, 1]),
  );
  expect((await sdk.create?.({}, context("create")))?.providerId).toBe(
    machine.providerId,
  );
});

test.each(["ephemeral", "persistent", "memory"] as const)(
  "profile %s makes persistence semantics explicit",
  async (profile) => {
    const f = createSimulatedProvider({ profile });
    const sdk = f.provider.adapter,
      machine = await sdk.create?.({}, context("create"));
    if (!machine) throw new Error("Missing machine");
    await sdk.files?.write?.(
      machine.providerId,
      "/workspace/data",
      new TextEncoder().encode("retained").buffer,
      context("write"),
    );
    const stopped = await sdk.stop?.(machine.providerId, context("stop"));
    expect(stopped?.state).toBe(profile === "memory" ? "paused" : "stopped");
    await (profile === "memory"
      ? sdk.resumeMemory?.(machine.providerId, context("resume"))
      : sdk.start?.(machine.providerId, context("start")));
    if (profile === "ephemeral")
      await expect(
        sdk.files?.read?.(
          machine.providerId,
          "/workspace/data",
          { offset: 0, maxBytes: 20 },
          context("read"),
        ),
      ).rejects.toMatchObject({ data: { code: "stale_resource" } });
    else
      expect(
        (
          await sdk.files?.read?.(
            machine.providerId,
            "/workspace/data",
            { offset: 0, maxBytes: 20 },
            context("read"),
          )
        )?.totalBytes,
      ).toBe(8);
  },
);

test("fixture commands expose queued/running/completed and cancellation without a shell", async () => {
  const f = createSimulatedProvider(),
    sdk = f.provider.adapter;
  const machine = await sdk.create?.({}, context("create"));
  if (!machine || !sdk.execution) throw new Error("Missing execution fixture");
  await expect(
    sdk.execution.start(
      machine.providerId,
      { kind: "shell", command: "touch /tmp/must-not-run" },
      context("shell"),
    ),
  ).rejects.toMatchObject({ data: { code: "unsupported" } });
  const job = await sdk.execution.start(
    machine.providerId,
    { kind: "argv", executable: "fixture", args: ["progress", "2", "hello"] },
    context("job"),
  );
  expect(job.state).toBe("queued");
  expect(
    (
      await sdk.execution.status(
        machine.providerId,
        job.executionId,
        context("status"),
      )
    ).state,
  ).toBe("running");
  expect(
    await sdk.execution.cancel?.(
      machine.providerId,
      job.executionId,
      context("cancel"),
    ),
  ).toEqual({ acknowledged: true });
  expect(
    (
      await sdk.execution.status(
        machine.providerId,
        job.executionId,
        context("status"),
      )
    ).state,
  ).toBe("cancelled");
});

test("filesystem and interpreter limits reject traversal and expensive writes", async () => {
  const f = createSimulatedProvider(),
    sdk = f.provider.adapter;
  const machine = await sdk.create?.({}, context("create"));
  if (!machine) throw new Error("Missing machine");
  await expect(
    sdk.files?.write?.(
      machine.providerId,
      "/workspace/../private",
      new ArrayBuffer(1),
      context("bad"),
    ),
  ).rejects.toMatchObject({ data: { code: "validation" } });
  await expect(
    sdk.files?.write?.(
      machine.providerId,
      "/workspace/big",
      new ArrayBuffer(65537),
      context("big"),
    ),
  ).rejects.toMatchObject({ data: { code: "quota" } });
  expect(f.snapshot().machines[0]?.files).toHaveLength(0);
});

test("failure injection distinguishes rejected work from lost replies after side effects", async () => {
  const f = createSimulatedProvider();
  f.faults.failNext("create", "before");
  await expect(
    f.provider.adapter.create?.({}, context("before")),
  ).rejects.toMatchObject({ data: { outcome: "not_started" } });
  expect(f.snapshot().machines).toHaveLength(0);
  f.faults.failNext("create", "after");
  await expect(
    f.provider.adapter.create?.({}, context("after")),
  ).rejects.toMatchObject({ data: { outcome: "unknown" } });
  expect(f.snapshot().machines).toHaveLength(1);
  expect(f.faults.counts().create).toEqual({ attempts: 2, dispatched: 1 });
});

test("optional features go through public capability guards", async () => {
  const f = createSimulatedProvider({ profile: "ephemeral" });
  const providers = new SandboxProviders({ authorize: async () => {} });
  providers.register(f.provider);
  expect(f.provider.capabilities?.supported).not.toContain("snapshotDisk");
  expect(f.provider.adapter.images).toBeUndefined();
  expect(f.provider.adapter.connections).toBeUndefined();
});

test("restored fixture snapshots are validated and isolated from caller mutation", async () => {
  const f = createSimulatedProvider();
  await f.provider.adapter.create?.({}, context("create"));
  const saved = f.snapshot(),
    restored = createSimulatedProvider({ state: saved });
  saved.machines[0].state = "deleted";
  expect((await restored.provider.adapter.describe("sim-vm-1")).state).toBe(
    "running",
  );
  expect(() =>
    createSimulatedProvider({ state: { ...saved, version: 99 } }),
  ).toThrow("Invalid simulated state");
});

test("restored ID counters cannot collide with retained native resources", async () => {
  const f = createSimulatedProvider();
  await f.provider.adapter.create?.({}, context("create"));
  expect(() =>
    createSimulatedProvider({ state: { ...f.snapshot(), nextId: 0 } }),
  ).toThrow("Invalid simulated state");
});

test("fixture directory ordering is independent of host locale", async () => {
  const f = createSimulatedProvider(),
    sdk = f.provider.adapter,
    m = await sdk.create?.({}, context("create"));
  if (!m) throw new Error("Missing fixture");
  for (const name of ["z", "A", "ä"])
    await sdk.files?.write?.(
      m.providerId,
      `/workspace/${name}`,
      new ArrayBuffer(0),
      context(name),
    );
  expect(
    (
      await sdk.files?.list?.(
        m.providerId,
        "/workspace",
        { cursor: null, maxEntries: 10 },
        context("list"),
      )
    )?.entries.map((entry) => entry.name),
  ).toEqual(["A", "z", "ä"]);
});

test("native log cursors preserve UTF-8 content when page byte budgets change", async () => {
  const f = createSimulatedProvider(),
    sdk = f.provider.adapter,
    m = await sdk.create?.({}, context("create"));
  if (!m || !sdk.execution?.logs) throw new Error("Missing fixture");
  const job = await sdk.execution.start(
    m.providerId,
    { kind: "argv", executable: "fixture", args: ["echo", "🦊abc"] },
    context("command"),
  );
  const first = await sdk.execution.logs(
    m.providerId,
    job.executionId,
    { cursor: null, maxEntries: 2, maxBytes: 4 },
    context("logs"),
  );
  const second = await sdk.execution.logs(
    m.providerId,
    job.executionId,
    { cursor: first.nextCursor, maxEntries: 2, maxBytes: 16 },
    context("logs"),
  );
  expect(
    [...first.entries, ...second.entries].map((entry) => entry.text).join(""),
  ).toBe("🦊abc\n");
});

test("pending image jobs and file contents survive a JSON fixture checkpoint", async () => {
  const f = createSimulatedProvider(),
    sdk = f.provider.adapter;
  const m = await sdk.create?.({}, context("create"));
  if (!m || !sdk.images?.snapshotDisk) throw new Error("Missing fixture");
  await sdk.files?.write?.(
    m.providerId,
    "/workspace/original",
    new Uint8Array([1, 2]).buffer,
    context("write"),
  );
  const pending = await sdk.images.snapshotDisk(
    m.providerId,
    context("snapshot"),
  );
  if (pending.state !== "pending") throw new Error("Missing image job");
  const restored = createSimulatedProvider({
    state: JSON.parse(JSON.stringify(f.snapshot())),
  });
  expect(
    await restored.provider.adapter.images?.status?.(
      m.providerId,
      pending.operationId,
      context("status"),
    ),
  ).toMatchObject({
    state: "ready",
    result: { image: { provider: "simulated", kind: "disk-snapshot" } },
  });
});

test("aggregate fixture quota rolls back a mutation that exceeds serialized state capacity", async () => {
  const f = createSimulatedProvider(),
    sdk = f.provider.adapter,
    m = await sdk.create?.({}, context("create"));
  if (!m) throw new Error("Missing fixture");
  const bytes = new Uint8Array(65536).fill(255).buffer;
  await sdk.files?.write?.(
    m.providerId,
    "/workspace/first",
    bytes,
    context("first"),
  );
  await expect(
    sdk.files?.write?.(
      m.providerId,
      "/workspace/second",
      bytes,
      context("second"),
    ),
  ).rejects.toMatchObject({ data: { code: "quota" } });
  expect(f.snapshot().machines[0].files).toHaveLength(1);
});

test("fixed fixture resources and unsupported connection kinds reject explicit requests", async () => {
  const f = createSimulatedProvider();
  await expect(
    f.provider.adapter.create?.(
      { resources: { cpuCount: 2 } },
      context("resources"),
    ),
  ).rejects.toMatchObject({ data: { code: "unsupported" } });
  const machine = await f.provider.adapter.create?.({}, context("create"));
  if (!machine) throw new Error("Missing fixture");
  await expect(
    f.provider.adapter.connections?.get(
      machine.providerId,
      { kind: "desktop", expiresInMs: 10000 },
      context("desktop"),
    ),
  ).rejects.toMatchObject({ data: { code: "unsupported" } });
});

test("checkpoint hooks finish before a deliberately lost SDK reply", async () => {
  const saved: unknown[] = [];
  const f = createSimulatedProvider({
    onChange: async (state) => {
      saved.push(state);
    },
  });
  f.faults.failNext("create", "after");
  await expect(
    f.provider.adapter.create?.({}, context("create")),
  ).rejects.toMatchObject({ data: { outcome: "unknown" } });
  const recovered = createSimulatedProvider({ state: saved[0] });
  expect(
    await recovered.provider.adapter.findCreate?.("create", context("find")),
  ).toMatchObject({ providerId: "sim-vm-1" });
});

test("checkpoint failures are unknown and never leak the callback's raw message", async () => {
  const f = createSimulatedProvider({
    onChange: async () => {
      throw new Error("private storage error");
    },
  });
  await expect(
    f.provider.adapter.create?.({}, context("create")),
  ).rejects.toMatchObject({
    data: { code: "unknown_outcome", outcome: "unknown" },
  });
  expect(f.snapshot().machines).toHaveLength(1);
});

test("async checkpoint hooks serialize fixture mutations and receive detached state", async () => {
  let enter: () => void = () => {},
    release: () => void = () => {};
  const entered = new Promise<void>((resolve) => {
      enter = resolve;
    }),
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
  const sizes: number[] = [];
  const f = createSimulatedProvider({
    onChange: async (state) => {
      sizes.push(state.machines.length);
      if (sizes.length === 1) {
        enter();
        await gate;
      }
      state.machines.length = 0;
    },
  });
  const first = f.provider.adapter.create?.({}, context("first"));
  await entered;
  const second = f.provider.adapter.create?.({}, context("second"));
  try {
    expect(f.snapshot().machines).toHaveLength(1);
  } finally {
    release();
  }
  await Promise.all([first, second]);
  expect(sizes).toEqual([1, 2]);
  expect(f.snapshot().machines).toHaveLength(2);
});
