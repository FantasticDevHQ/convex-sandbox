import { convexTest } from "convex-test";
import { defineSchema } from "convex/server";
import { expect, test, vi } from "vitest";
import { register } from "@fantastic.dev/convex-sandbox/testing";
import {
  SandboxProviders,
  registerProvider,
  SandboxProviderError,
  type LifecycleStore,
  type SandboxAdapter,
  type AuthorizeSandbox,
} from "@fantastic.dev/convex-sandbox";

const sandbox = { scope: "fixture", key: "machine" };
const result = (
  providerId = "vm-1",
  state: "running" | "stopped" | "paused" | "deleted" = "running",
) => ({ providerId, state });
function fixture(
  adapter: SandboxAdapter,
  createIdempotency: "native" | "none" = "native",
  authorize: AuthorizeSandbox = async () => {},
) {
  const t = convexTest(defineSchema({}), {
    "./_generated/server.js": () =>
      import("../example/convex/_generated/server.js"),
  });
  const c = register(t);
  const store: LifecycleStore = {
    get: (sandbox) => t.query(c.registry.get, { sandbox }),
    getOperation: (sandbox, operationId) =>
      t.query(c.operations.get, { sandbox, operationId }),
    begin: (args) => t.mutation(c.operations.begin, args),
    reserveCreate: (args) => t.mutation(c.lifecycle.reserveCreate, args),
    getProvision: (sandbox) => t.query(c.lifecycle.getProvision, { sandbox }),
    claimCreateReconciliation: (args) =>
      t.mutation(c.lifecycle.claimCreateReconciliation, args),
    finishCreate: (args) => t.mutation(c.lifecycle.finishCreate, args),
    claimOperation: (args) => t.mutation(c.lifecycle.claimOperation, args),
    finishOperation: (args) => t.mutation(c.lifecycle.finishOperation, args),
    beginRefresh: (sandbox) => t.mutation(c.registry.beginRefresh, { sandbox }),
    finishRefresh: (args) => t.mutation(c.registry.finishRefresh, args),
  };
  const providers = new SandboxProviders({
    authorize,
    authorizeCreate: async () => {},
  });
  providers.register(
    registerProvider({
      name: "fixture",
      adapter,
      createIdempotency,
      capabilities: {
        version: 1,
        supported: [
          "create",
          "describe",
          "start",
          "stop",
          "delete",
          "resumeMemory",
        ],
      },
    }),
  );
  return { t, c, store, lifecycle: providers.lifecycle(store) };
}
function adapter(overrides: Partial<SandboxAdapter> = {}): SandboxAdapter {
  return {
    describe: async () => result(),
    create: async () => result(),
    start: async () => result(),
    resumeMemory: async () => result(),
    stop: async () => result("vm-1", "stopped"),
    delete: async () => result("vm-1", "deleted"),
    ...overrides,
  };
}

test("concurrent creates reserve before SDK effects and pass a stable idempotency key", async () => {
  const keys: string[] = [];
  const f = fixture(
    adapter({
      create: async (_, context) => {
        keys.push(context.idempotencyKey);
        return result();
      },
    }),
  );
  await Promise.all(
    ["create-a", "create-b"].map((operationId) =>
      f.lifecycle
        .create({ sandbox, provider: "fixture", operationId })
        .catch(() => null),
    ),
  );
  expect(keys).toHaveLength(1);
  expect(await f.lifecycle.get(sandbox)).toMatchObject({
    reference: { providerId: "vm-1" },
  });
});

test("lost reply with no provider idempotency never automatically creates another machine", async () => {
  let calls = 0;
  const f = fixture(
    adapter({
      create: async () => {
        calls++;
        throw new Error("lost private reply");
      },
    }),
    "none",
  );
  await f.lifecycle.create({
    sandbox,
    provider: "fixture",
    operationId: "lost",
  });
  await f.lifecycle.create({
    sandbox,
    provider: "fixture",
    operationId: "lost",
  });
  expect(calls).toBe(1);
  expect(await f.store.getProvision(sandbox)).toMatchObject({
    status: "unknown",
    operationId: "lost",
    idempotency: "none",
  });
});

test("interrupted persistence retains create identity and reconciles by lookup without another create", async () => {
  let creates = 0;
  const f = fixture(
    adapter({
      create: async () => {
        creates++;
        return result();
      },
      findCreate: async () => result(),
    }),
  );
  const original = f.store.finishCreate;
  f.store.finishCreate = async () => {
    throw new Error("interrupted action");
  };
  await expect(
    f.lifecycle.create({
      sandbox,
      provider: "fixture",
      operationId: "interrupted",
    }),
  ).rejects.toThrow("interrupted action");
  f.store.finishCreate = original;
  vi.useFakeTimers();
  try {
    vi.setSystemTime(Date.now() + 31000);
    await f.lifecycle.reconcileCreate({ sandbox, operationId: "interrupted" });
  } finally {
    vi.useRealTimers();
  }
  expect(creates).toBe(1);
  expect(await f.store.getProvision(sandbox)).toMatchObject({
    status: "succeeded",
    operationId: "interrupted",
  });
});

test("known capacity refusal is recorded and a fresh create operation may be admitted", async () => {
  let calls = 0;
  const f = fixture(
    adapter({
      create: async () => {
        calls++;
        if (calls === 1)
          throw new SandboxProviderError({
            code: "capacity",
            outcome: "not_started",
            retryable: true,
          });
        return result();
      },
    }),
  );
  await f.lifecycle.create({
    sandbox,
    provider: "fixture",
    operationId: "capacity",
  });
  expect(await f.store.getProvision(sandbox)).toMatchObject({
    status: "failed",
    errorCode: "capacity",
  });
  await f.lifecycle.create({
    sandbox,
    provider: "fixture",
    operationId: "retry-new-id",
  });
  expect(calls).toBe(2);
});

test("paused machines resume through the explicit capability and failed resume remains visible", async () => {
  let starts = 0;
  const f = fixture(
    adapter({
      create: async () => result("vm-1", "paused"),
      start: async () => {
        starts++;
        return result();
      },
      resumeMemory: async () => {
        throw new SandboxProviderError({
          code: "capacity",
          outcome: "not_started",
          retryable: true,
        });
      },
    }),
  );
  await f.lifecycle.create({
    sandbox,
    provider: "fixture",
    operationId: "create",
  });
  const op = await f.lifecycle.run({
    sandbox,
    operationId: "resume",
    action: "start",
  });
  expect(op).toMatchObject({
    kind: "resumeMemory",
    status: "failed",
    errorCode: "capacity",
  });
  expect(starts).toBe(0);
  expect(await f.lifecycle.get(sandbox)).toMatchObject({
    observedState: "paused",
  });
});

test("bounded reconciliation only describes and stops when the target is observed", async () => {
  let reads = 0;
  let starts = 0;
  const f = fixture(
    adapter({
      start: async () => {
        starts++;
        return { providerId: "vm-1", state: "starting" };
      },
      describe: async () => {
        reads++;
        return reads === 1
          ? { providerId: "vm-1", state: "starting" }
          : result();
      },
    }),
  );
  await f.lifecycle.create({
    sandbox,
    provider: "fixture",
    operationId: "create",
  });
  await f.lifecycle.run({ sandbox, operationId: "start", action: "start" });
  const delays: number[] = [];
  const op = await f.lifecycle.reconcile({
    sandbox,
    operationId: "start",
    policy: { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 20 },
    wait: async (ms) => {
      delays.push(ms);
    },
  });
  expect(op?.status).toBe("succeeded");
  expect(starts).toBe(1);
  expect(reads).toBe(2);
  expect(delays).toEqual([10]);
});

test("authenticated observation tickets deduplicate and reject old observations", async () => {
  const f = fixture(adapter());
  await f.lifecycle.create({
    sandbox,
    provider: "fixture",
    operationId: "create",
  });
  const old = await f.store.beginRefresh(sandbox);
  const latest = await f.store.beginRefresh(sandbox);
  expect(
    await f.lifecycle.observe({
      sandbox,
      ticket: latest,
      description: result(),
    }),
  ).toBe(true);
  expect(
    await f.lifecycle.observe({
      sandbox,
      ticket: old,
      description: result("vm-1", "stopped"),
    }),
  ).toBe(false);
  expect(
    await f.lifecycle.observe({
      sandbox,
      ticket: latest,
      description: result("vm-1", "stopped"),
    }),
  ).toBe(false);
});

test("expired worker cannot publish after reconciliation takes over; delete remains terminal", async () => {
  const f = fixture(adapter());
  await f.lifecycle.create({
    sandbox,
    provider: "fixture",
    operationId: "create",
  });
  const row = await f.store.get(sandbox);
  const op = await f.store.begin({
    sandbox,
    expectedVersion: row?.version ?? -1,
    operationId: "old",
    kind: "stop",
  });
  const lease = await f.store.claimOperation({
    sandbox,
    operationId: op.operationId,
    expectedVersion: op.version,
    mode: "execute",
  });
  vi.useFakeTimers();
  try {
    vi.setSystemTime(Date.now() + 31000);
    await f.lifecycle.reconcile({
      sandbox,
      operationId: "old",
      policy: { maxAttempts: 1 },
    });
    expect(
      await f.store.finishOperation({
        sandbox,
        operationId: "old",
        expectedVersion: lease?.version ?? -1,
        result: { description: result("vm-1", "stopped") },
      }),
    ).toBe(false);
  } finally {
    vi.useRealTimers();
  }
  // Resolve the uncertain stop from an explicit provider observation before deletion.
  const unknown = await f.store.getOperation(sandbox, "old");
  if (unknown?.status === "unknown") {
    const claim = await f.store.claimOperation({
      sandbox,
      operationId: "old",
      expectedVersion: unknown.version,
      mode: "reconcile",
    });
    await f.store.finishOperation({
      sandbox,
      operationId: "old",
      expectedVersion: claim?.version ?? -1,
      result: { description: result("vm-1", "stopped") },
    });
  }
  await f.lifecycle.run({ sandbox, operationId: "delete", action: "delete" });
  expect(await f.lifecycle.get(sandbox)).toMatchObject({
    tombstone: true,
    observedState: "deleted",
  });
});

test("SDK timeout retains an unknown create and ignores a late reply", async () => {
  let resolve: (value: ReturnType<typeof result>) => void = () => {};
  const pending = new Promise<ReturnType<typeof result>>((done) => {
    resolve = done;
  });
  const f = fixture(adapter({ create: async () => pending }));
  vi.useFakeTimers();
  try {
    const call = f.lifecycle.create({
      sandbox,
      provider: "fixture",
      operationId: "timeout",
    });
    await vi.advanceTimersByTimeAsync(5001);
    await call;
    expect(await f.store.getProvision(sandbox)).toMatchObject({
      status: "unknown",
      errorCode: "timeout",
    });
    resolve(result());
    await Promise.resolve();
    expect(await f.store.get(sandbox)).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

test("polling exhausts a bounded budget and never retries an execution command", async () => {
  let reads = 0;
  const f = fixture(
    adapter({
      start: async () => ({ providerId: "vm-1", state: "starting" }),
      describe: async () => {
        reads++;
        return { providerId: "vm-1", state: "starting" };
      },
    }),
  );
  await f.lifecycle.create({
    sandbox,
    provider: "fixture",
    operationId: "create",
  });
  await f.lifecycle.run({ sandbox, operationId: "start", action: "start" });
  const op = await f.lifecycle.reconcile({
    sandbox,
    operationId: "start",
    policy: { maxAttempts: 2 },
    wait: async () => {},
  });
  expect(op?.status).toBe("unknown");
  expect(reads).toBe(2);
  await expect(
    f.lifecycle.reconcile({
      sandbox,
      operationId: "start",
      policy: { maxAttempts: 100 },
    }),
  ).rejects.toThrow("Polling policy exceeds bounds");
});

test("creation requires its own authorization and explicit native idempotency declaration", async () => {
  const p = new SandboxProviders({ authorize: async () => {} });
  const sdk = adapter();
  expect(() =>
    p.register(
      registerProvider({
        name: "invalid",
        adapter: sdk,
        capabilities: { version: 1, supported: ["create"] },
      }),
    ),
  ).toThrow("Create requires explicit idempotency support");
  p.register(
    registerProvider({
      name: "fixture",
      adapter: sdk,
      createIdempotency: "none",
      capabilities: { version: 1, supported: ["create", "describe"] },
    }),
  );
  const f = fixture(sdk);
  await expect(
    p
      .lifecycle(f.store)
      .create({ sandbox, provider: "fixture", operationId: "denied" }),
  ).rejects.toMatchObject({ data: { code: "authorization" } });
  expect(await f.store.getProvision(sandbox)).toBeNull();
});

test("caller mutation during create authorization cannot change the reserved scope", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = fixture(adapter());
  const providers = new SandboxProviders({
    authorize: async () => {},
    authorizeCreate: async () => gate,
  });
  providers.register(
    registerProvider({
      name: "fixture",
      adapter: adapter(),
      createIdempotency: "none",
      capabilities: { version: 1, supported: ["create", "describe"] },
    }),
  );
  const mutable = { ...sandbox };
  const call = providers
    .lifecycle(f.store)
    .create({ sandbox: mutable, provider: "fixture", operationId: "scoped" });
  mutable.scope = "foreign";
  release();
  await call;
  expect(await f.store.get(sandbox)).not.toBeNull();
  expect(await f.store.get(mutable)).toBeNull();
});

test("a leased worker cannot overwrite an observation that started later", async () => {
  const f = fixture(adapter());
  await f.lifecycle.create({
    sandbox,
    provider: "fixture",
    operationId: "create",
  });
  const row = await f.store.get(sandbox);
  const op = await f.store.begin({
    sandbox,
    expectedVersion: row?.version ?? -1,
    operationId: "start",
    kind: "start",
  });
  const claim = await f.store.claimOperation({
    sandbox,
    operationId: "start",
    expectedVersion: op.version,
    mode: "execute",
  });
  const newer = await f.store.beginRefresh(sandbox);
  await f.lifecycle.observe({
    sandbox,
    ticket: newer,
    description: result("vm-1", "stopped"),
  });
  expect(
    await f.store.finishOperation({
      sandbox,
      operationId: "start",
      expectedVersion: claim?.version ?? -1,
      result: { description: result() },
    }),
  ).toBe(false);
  expect(await f.lifecycle.get(sandbox)).toMatchObject({
    observedState: "stopped",
  });
});

test("lifecycle reconciliation rejects arbitrary execution records without calling the SDK", async () => {
  let reads = 0;
  const f = fixture(
    adapter({
      describe: async () => {
        reads++;
        return result();
      },
    }),
  );
  await f.lifecycle.create({
    sandbox,
    provider: "fixture",
    operationId: "create",
  });
  const row = await f.store.get(sandbox);
  const operation = await f.t.mutation(f.c.operations.begin, {
    sandbox,
    expectedVersion: row?.version ?? -1,
    operationId: "command",
    kind: "execute",
  });
  await f.t.mutation(f.c.operations.transition, {
    sandbox,
    operationId: "command",
    expectedVersion: operation.version,
    status: "unknown",
  });
  await expect(
    f.lifecycle.reconcile({ sandbox, operationId: "command" }),
  ).rejects.toThrow("Invalid lifecycle operation");
  expect(reads).toBe(0);
});

test("refresh prepares the binding belonging to its ticket after a pre-ticket rebind", async () => {
  const described: string[] = [];
  const f = fixture(
    adapter({
      describe: async (id) => {
        described.push(id);
        return result(id, "stopped");
      },
    }),
  );
  await f.t.mutation(f.c.registry.ensure, {
    sandbox,
    reference: { provider: "fixture", providerId: "vm-old" },
  });
  const begin = f.store.beginRefresh;
  f.store.beginRefresh = async (key) => {
    // Simulate a completed deletion and rebind after prepare/authorize, before
    // the caller receives its refresh ticket for the current generation.
    const deletion = await begin(key);
    await f.store.finishRefresh({
      sandbox: key,
      ...deletion,
      result: { state: "deleted" },
    });
    const old = await f.store.get(key);
    if (!old) throw new Error("Missing fixture");
    await f.t.mutation(f.c.registry.rebind, {
      sandbox: key,
      expectedVersion: old.version,
      reference: { provider: "fixture", providerId: "vm-new" },
    });
    return begin(key);
  };
  const row = await f.lifecycle.refresh(sandbox);
  expect(described).toEqual(["vm-new"]);
  expect(row?.reference.providerId).toBe("vm-new");
  expect(row?.generation).toBe(2);
  expect(row?.observedState).toBe("stopped");
});

test("refresh reauthorizes a concurrent rebound reference before returning it", async () => {
  let f: ReturnType<typeof fixture>;
  f = fixture(
    adapter({
      describe: async () => {
        const ticket = await f.store.beginRefresh(sandbox);
        await f.store.finishRefresh({
          sandbox,
          ...ticket,
          result: { state: "deleted" },
        });
        const row = await f.store.get(sandbox);
        if (!row) throw new Error("Missing fixture");
        await f.t.mutation(f.c.registry.rebind, {
          sandbox,
          expectedVersion: row.version,
          reference: { provider: "fixture", providerId: "vm-foreign" },
        });
        return result("vm-old", "running");
      },
    }),
    "native",
    async ({ reference }) => {
      if (reference.providerId === "vm-foreign")
        throw new SandboxProviderError({
          code: "authorization",
          outcome: "not_started",
          retryable: false,
        });
    },
  );
  await f.t.mutation(f.c.registry.ensure, {
    sandbox,
    reference: { provider: "fixture", providerId: "vm-old" },
  });
  await expect(f.lifecycle.refresh(sandbox)).rejects.toMatchObject({
    data: { code: "authorization" },
  });
});
