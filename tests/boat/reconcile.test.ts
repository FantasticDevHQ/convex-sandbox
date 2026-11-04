import { convexTest } from "convex-test";
import { defineSchema } from "convex/server";
import { expect, test, vi } from "vitest";
import {
  register,
  createTestStores,
} from "@fantastic.dev/convex-sandbox/testing";
import { SandboxProviders } from "@fantastic.dev/convex-sandbox";
import { createBoatProvider } from "@fantastic.dev/convex-sandbox/boat";

const sandbox = { scope: "boat-refresh-fixture", key: "machine" },
  id = "refresh-vm";
const json = (phase: string) =>
  new Response(
    JSON.stringify({ ok: true, sandbox: { id, state: phase, vcpu: 2 } }),
  );
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture() {
  const calls: Array<{
    method: string | undefined;
    signal: AbortSignal | null | undefined;
  }> = [];
  const state: {
    phase: string;
    status: number;
    read?: (init: RequestInit) => Promise<Response>;
  } = { phase: "ready", status: 200 };
  const provider = createBoatProvider({
    apiKey: "synthetic-refresh-key",
    fetch: async (_url, init = {}) => {
      calls.push({ method: init.method, signal: init.signal });
      if (init.method === "DELETE")
        return new Response(
          JSON.stringify({
            ok: true,
            operation: {
              id: "confirmed-delete",
              targetId: id,
              kind: "sandbox",
              status: "completed",
            },
          }),
        );
      if (init.method === "POST")
        return new Response(
          JSON.stringify({
            ok: true,
            id,
            sandbox: { id, state: "provisioning" },
          }),
          { status: 202 },
        );
      if (state.read) return state.read(init);
      if (state.status !== 200)
        return new Response(
          JSON.stringify({ error: "synthetic-private-error" }),
          { status: state.status },
        );
      return json(state.phase);
    },
  });
  const t = convexTest(defineSchema({}), {
    "./_generated/server.js": () =>
      import("../../example/convex/_generated/server.js"),
  });
  const c = register(t),
    store = createTestStores(t, c, () => true).lifecycle;
  await t.mutation(c.registry.ensure, {
    sandbox,
    reference: { provider: "boat", providerId: id },
  });
  const client = () => {
    const p = new SandboxProviders({ authorize: async () => {} });
    p.register(provider);
    return p.lifecycle(store);
  };
  return { state, calls, t, c, store, client };
}

test("external state refresh is visible through the shared reactive query without an owned mutation", async () => {
  const f = await fixture();
  await f.client().refresh(sandbox);
  f.state.phase = "archived";
  await f.client().refresh(sandbox);
  expect(await f.t.query(f.c.registry.get, { sandbox })).toMatchObject({
    observedState: "stopped",
    refresh: { status: "fresh" },
    resources: { cpuCount: 2 },
    observedSequence: 2,
  });
  expect(f.calls.map((call) => call.method)).toEqual(["GET", "GET"]);
});

test.each(["success", "failure"])(
  "reversed native %s cannot overwrite a newer accepted observation",
  async (outcome) => {
    const f = await fixture(),
      old = deferred<Response>(),
      started = deferred<void>();
    let reads = 0;
    f.state.read = async () => {
      if (++reads === 1) {
        started.resolve();
        return old.promise;
      }
      return json("ready");
    };
    const stale = f.client().refresh(sandbox);
    await started.promise;
    await f.client().refresh(sandbox);
    old.resolve(
      outcome === "success"
        ? json("archived")
        : new Response(null, { status: 503 }),
    );
    await stale;
    expect(await f.store.get(sandbox)).toMatchObject({
      observedState: "running",
      refresh: { status: "fresh" },
      refreshSequence: 2,
      observedSequence: 2,
    });
    expect(f.calls).toHaveLength(2);
  },
);

test("an old native reply cannot alter a deleted/rebound generation", async () => {
  const f = await fixture(),
    old = deferred<Response>(),
    started = deferred<void>();
  f.state.read = async () => {
    started.resolve();
    return old.promise;
  };
  const stale = f.client().refresh(sandbox);
  await started.promise;
  await f.client().run({ sandbox, action: "delete", operationId: "delete" });
  const deleted = await f.store.get(sandbox);
  await f.t.mutation(f.c.registry.rebind, {
    sandbox,
    expectedVersion: deleted?.version ?? -1,
    reference: { provider: "boat", providerId: "replacement-vm" },
  });
  old.resolve(json("ready"));
  await stale;
  expect(await f.store.get(sandbox)).toMatchObject({
    generation: 2,
    reference: { providerId: "replacement-vm" },
    observedState: "unknown",
    refresh: { status: "never" },
  });
});

test.each([
  [404, "stale_resource"],
  [503, "capacity"],
] as const)(
  "failed refresh HTTP %i retains the last observed state",
  async (status, code) => {
    const f = await fixture();
    await f.client().refresh(sandbox);
    f.state.status = status;
    expect(await f.client().refresh(sandbox)).toMatchObject({
      observedState: "running",
      tombstone: false,
      refresh: { status: "failed", errorCode: code },
    });
    expect(JSON.stringify(await f.store.get(sandbox))).not.toContain(
      "synthetic-private-error",
    );
  },
);

test("transitional native state returns at the host attempt budget with no settle loop", async () => {
  const f = await fixture();
  f.state.phase = "provisioning";
  await f.client().run({ sandbox, action: "start", operationId: "resume" });
  const waited: number[] = [];
  const result = await f.client().reconcile({
    sandbox,
    operationId: "resume",
    policy: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 1 },
    wait: async (ms) => {
      waited.push(ms);
    },
  });
  expect(result?.status).toBe("unknown");
  expect(waited).toEqual([1]);
  expect(f.calls.map((call) => call.method)).toEqual(["POST", "GET", "GET"]);
});

test("elapsed polling budget stops before the next delay without mutation replay", async () => {
  vi.useFakeTimers();
  try {
    const f = await fixture();
    f.state.phase = "provisioning";
    await f.client().run({ sandbox, action: "start", operationId: "resume" });
    let waits = 0;
    const result = await f.client().reconcile({
      sandbox,
      operationId: "resume",
      policy: {
        maxAttempts: 10,
        baseDelayMs: 2,
        maxDelayMs: 2,
        maxElapsedMs: 4,
        callTimeoutMs: 3,
      },
      wait: async (ms) => {
        waits++;
        vi.setSystemTime(Date.now() + ms);
      },
    });
    expect(result?.status).toBe("unknown");
    expect(waits).toBe(1);
    expect(f.calls.map((call) => call.method)).toEqual(["POST", "GET", "GET"]);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

test("a hung native read aborts at the host call budget and leaves no timers or replay", async () => {
  vi.useFakeTimers();
  try {
    const f = await fixture();
    await f.client().run({ sandbox, action: "start", operationId: "resume" });
    const started = deferred<void>();
    let signal: AbortSignal | null | undefined;
    f.state.read = async (init) => {
      signal = init.signal;
      started.resolve();
      return new Promise<Response>(() => {});
    };
    const pending = f
      .client()
      .reconcile({
        sandbox,
        operationId: "resume",
        policy: { maxAttempts: 1, maxElapsedMs: 10, callTimeoutMs: 10 },
      });
    await started.promise;
    await vi.advanceTimersByTimeAsync(10);
    expect(await pending).toMatchObject({
      status: "unknown",
      errorCode: "timeout",
    });
    expect(signal?.aborted).toBe(true);
    expect(f.calls.map((call) => call.method)).toEqual(["POST", "GET"]);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
