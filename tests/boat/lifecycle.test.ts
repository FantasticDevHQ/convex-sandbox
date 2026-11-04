import { convexTest } from "convex-test";
import { defineSchema } from "convex/server";
import { expect, test } from "vitest";
import {
  register,
  createTestStores,
} from "@fantastic.dev/convex-sandbox/testing";
import { SandboxProviders } from "@fantastic.dev/convex-sandbox";
import { createBoatProvider } from "@fantastic.dev/convex-sandbox/boat";

const sandbox = { scope: "boat-lifecycle-fixture", key: "machine" };
const id = "vm-1";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

async function fixture(topStop = false) {
  const state = {
    machine: "ready",
    stop: "pending",
    deletion: "pending",
    jobId: "delete-1",
    targetId: id,
    kind: "sandbox",
    deleted: false,
    lost: false,
  };
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch: typeof globalThis.fetch = async (url, init = {}) => {
    const path = new URL(String(url)).pathname;
    calls.push({ url: String(url), init });
    if (init.method === "DELETE") {
      if (state.lost) throw new Error("synthetic-private-error");
      state.deleted = true;
      return json(
        {
          ok: true,
          operation: {
            id: state.jobId,
            targetId: state.targetId,
            kind: state.kind,
            status: state.deletion,
          },
        },
        202,
      );
    }
    if (path.endsWith("/stop")) {
      state.machine = "archiving";
      const stop = { id: "stop-1", status: state.stop };
      return json(
        {
          ok: true,
          id,
          sandbox: { id, state: state.machine, ...(topStop ? {} : { stop }) },
          ...(topStop ? { stop } : {}),
        },
        202,
      );
    }
    if (path.endsWith("/resume")) {
      state.machine = "provisioning";
      return json({ ok: true, id, sandbox: { id, state: state.machine } }, 202);
    }
    if (path.includes("/stops/"))
      return json({ ok: true, id, stop: { id: "stop-1", status: state.stop } });
    if (path.includes("/deletion-operations/"))
      return json({
        ok: true,
        operation: {
          id: state.jobId,
          targetId: state.targetId,
          kind: state.kind,
          status: state.deletion,
        },
      });
    if (state.deleted) return json({ error: "synthetic-private-error" }, 404);
    return json({ ok: true, sandbox: { id, state: state.machine } });
  };
  const provider = createBoatProvider({
    apiKey: "synthetic-lifecycle-key",
    ttlSeconds: 120,
    fetch,
  });
  const t = convexTest(defineSchema({}), {
    "./_generated/server.js": () =>
      import("../../example/convex/_generated/server.js"),
  });
  const c = register(t);
  const store = createTestStores(t, c, () => true).lifecycle;
  await t.mutation(c.registry.ensure, {
    sandbox,
    reference: { provider: "boat", providerId: id },
  });
  const client = () => {
    const providers = new SandboxProviders({ authorize: async () => {} });
    providers.register(provider);
    return providers.lifecycle(store);
  };
  return { state, calls, provider, client, store };
}

test.each([false, true])(
  "stop retains a native handle from nested/top-level replies (%s) without force or RAM claims",
  async (top) => {
    const f = await fixture(top);
    const op = await f
      .client()
      .run({ sandbox, operationId: "stop", action: "stop" });
    expect(op).toMatchObject({
      status: "unknown",
      nativeLifecycle: { id: "stop-1" },
    });
    expect(f.provider.capabilities?.persistence).toEqual({
      diskOnStop: "unknown",
      memoryOnStop: "discarded",
    });
    expect(f.provider.capabilities?.supported).not.toContain("resumeMemory");
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ force: false });
    await f.client().refresh(sandbox);
    expect((await f.store.getOperation(sandbox, "stop"))?.status).toBe(
      "unknown",
    );
    f.state.stop = "completed";
    f.state.machine = "archived";
    expect(
      await f.client().reconcile({
        sandbox,
        operationId: "stop",
        policy: { maxAttempts: 1 },
      }),
    ).toMatchObject({ status: "succeeded" });
    expect((await f.store.get(sandbox))?.observedState).toBe("stopped");
    expect(f.calls.filter((c) => c.init.method === "POST")).toHaveLength(1);
  },
);

test("a completed stop reply retains its handle before any potentially failing follow-up read", async () => {
  const f = await fixture();
  f.state.stop = "completed";
  const op = await f
    .client()
    .run({ sandbox, operationId: "stop", action: "stop" });
  expect(op).toMatchObject({
    status: "unknown",
    nativeLifecycle: { id: "stop-1" },
  });
  expect(f.calls).toHaveLength(1);
});

test("a historical completed or superseded stop does not claim a resumed machine is stopped", async () => {
  const f = await fixture();
  await f.client().run({ sandbox, operationId: "stop", action: "stop" });
  for (const status of ["completed", "superseded"]) {
    f.state.stop = status;
    f.state.machine = "running";
    expect(
      await f.client().reconcile({
        sandbox,
        operationId: "stop",
        policy: { maxAttempts: 1 },
      }),
    ).toMatchObject({ status: "unknown" });
    expect((await f.store.get(sandbox))?.observedState).toBe("running");
  }
});

test("resume uses the native disk resume endpoint and waits for observed readiness", async () => {
  const f = await fixture();
  const op = await f
    .client()
    .run({ sandbox, operationId: "start", action: "start" });
  expect(op?.status).toBe("unknown");
  expect(f.calls[0].url).toBe("https://boat.dev/api/v1/sandboxes/vm-1/resume");
  expect(JSON.parse(String(f.calls[0].init.body))).toEqual({
    ttlSeconds: 120,
    noEnv: true,
  });
  expect((await f.store.get(sandbox))?.observedState).toBe("starting");
  f.state.machine = "ready";
  expect(
    await f
      .client()
      .reconcile({ sandbox, operationId: "start", policy: { maxAttempts: 1 } }),
  ).toMatchObject({ status: "succeeded" });
});

test("accepted deletion stays pending despite sandbox 404 and completes by persisted job after a new client", async () => {
  const f = await fixture();
  const op = await f
    .client()
    .run({ sandbox, operationId: "delete", action: "delete" });
  expect(op).toMatchObject({
    status: "unknown",
    nativeLifecycle: { id: "delete-1" },
  });
  expect(
    new Headers(f.calls[0].init.headers).get("X-Ascii-Confirm-Delete"),
  ).toBe(id);
  await f.client().refresh(sandbox);
  expect((await f.store.get(sandbox))?.tombstone).toBe(false);
  for (const phase of ["pending", "processing", "blocked"]) {
    f.state.deletion = phase;
    expect(
      await f.client().reconcile({
        sandbox,
        operationId: "delete",
        policy: { maxAttempts: 1 },
      }),
    ).toMatchObject({ status: "unknown" });
  }
  f.state.deletion = "completed";
  expect(
    await f.client().reconcile({
      sandbox,
      operationId: "delete",
      policy: { maxAttempts: 1 },
    }),
  ).toMatchObject({ status: "succeeded" });
  expect((await f.store.get(sandbox))?.tombstone).toBe(true);
  expect(f.calls.filter((c) => c.init.method === "DELETE")).toHaveLength(1);
});

test.each(["targetId", "kind", "jobId"] as const)(
  "foreign deletion %s cannot publish a tombstone",
  async (field) => {
    const f = await fixture();
    await f.client().run({ sandbox, operationId: "delete", action: "delete" });
    f.state[field] = "foreign";
    f.state.deletion = "completed";
    expect(
      await f.client().reconcile({
        sandbox,
        operationId: "delete",
        policy: { maxAttempts: 1 },
      }),
    ).toMatchObject({ status: "unknown", errorCode: "validation" });
    expect((await f.store.get(sandbox))?.tombstone).toBe(false);
  },
);

test("lost deletion reply never authorizes another DELETE or infers completion from 404", async () => {
  const f = await fixture();
  f.state.lost = true;
  await f.client().run({ sandbox, operationId: "delete", action: "delete" });
  f.state.deleted = true;
  await f.client().run({ sandbox, operationId: "delete", action: "delete" });
  expect(
    await f.client().reconcile({
      sandbox,
      operationId: "delete",
      policy: { maxAttempts: 1 },
    }),
  ).toMatchObject({ status: "unknown" });
  expect((await f.store.get(sandbox))?.tombstone).toBe(false);
  expect(f.calls.filter((c) => c.init.method === "DELETE")).toHaveLength(1);
});
