import { convexTest } from "convex-test";
import { defineSchema } from "convex/server";
import { expect, test } from "vitest";
import {
  register,
  createTestStores,
} from "@fantastic.dev/convex-sandbox/testing";
import { SandboxProviders } from "@fantastic.dev/convex-sandbox";
import { createBoatProvider } from "@fantastic.dev/convex-sandbox/boat";

const sandbox = { scope: "boat-image-fixture", key: "machine" };
const handle = { sandbox, operationId: "fork" };
async function fixture() {
  const state = {
    phase: "provisioning",
    lost: false,
    missingId: false,
    replyId: "child-vm",
    childId: "child-vm",
    missing: false,
    catalog: [
      { name: "saving-image", sourceSandboxId: "source-vm", status: "saving" },
      {
        name: "ready-image",
        sourceSandboxId: "source-vm",
        status: "ready",
        snapshotId: "native-artifact-id",
      },
      {
        name: "failed-image",
        sourceSandboxId: "source-vm",
        status: "failed",
        error: "synthetic-private-error",
      },
      { name: "future-image", sourceSandboxId: "source-vm", status: "future" },
      {
        name: "missing-artifact",
        sourceSandboxId: "source-vm",
        status: "ready",
      },
      {
        name: "synthetic-private-other",
        sourceSandboxId: "other-vm",
        status: "ready",
        snapshotId: "other-artifact",
      },
    ],
  };
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const provider = createBoatProvider({
    apiKey: "synthetic-image-key",
    ttlSeconds: 1200,
    fetch: async (url, init = {}) => {
      const u = new URL(String(url));
      calls.push({ url: u, init });
      if (init.method === "POST") {
        if (state.lost) throw new Error("synthetic-private-provider-error");
        return new Response(
          JSON.stringify({
            ok: true,
            ...(state.missingId ? {} : { id: state.childId }),
            sandbox: { id: state.replyId, state: state.phase },
          }),
          { status: 202 },
        );
      }
      if (u.pathname.endsWith("/saved-snapshots"))
        return new Response(
          JSON.stringify({
            ok: true,
            snapshots: state.catalog,
            allowance: { private: "synthetic-private-metadata" },
          }),
        );
      if (state.missing) return new Response(null, { status: 404 });
      return new Response(
        JSON.stringify({
          ok: true,
          sandbox: {
            id: state.replyId,
            state: state.phase,
            secret: "synthetic-private-metadata",
          },
        }),
      );
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
    reference: { provider: "boat", providerId: "source-vm" },
  });
  const client = () => {
    const p = new SandboxProviders({ authorize: async () => {} });
    p.register(provider);
    return p.images(stores.images);
  };
  return { state, calls, provider, stores, client };
}

test("native fork publishes the child identity as pending before readiness reads and never rebinds source", async () => {
  const f = await fixture();
  const started = await f.client().run({ ...handle, kind: "fork" });
  expect(started).toMatchObject({
    status: "running",
    nativeImage: { providerOperationId: expect.any(String) },
  });
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0].url.pathname).toBe("/api/v1/sandboxes/source-vm/fork");
  expect(JSON.parse(String(f.calls[0].init.body))).toEqual({
    noEnv: true,
    env: {},
    ttlSeconds: 1200,
  });
  const key = new Headers(f.calls[0].init.headers).get("Idempotency-Key");
  expect(key).toMatch(/^csb-boat-v1-[a-f0-9]{64}$/);
  await f.client().run({ ...handle, kind: "fork" });
  expect((await f.client().status(handle))?.status).toBe("running");
  f.state.phase = "ready";
  expect(await f.client().status(handle)).toMatchObject({
    status: "succeeded",
    nativeImage: {
      result: { machine: { provider: "boat", providerId: "child-vm" } },
    },
  });
  expect(f.calls.filter((c) => c.init.method === "POST")).toHaveLength(1);
  expect(
    f.calls
      .slice(1)
      .every(
        (c) =>
          c.url.pathname === "/api/v1/sandboxes/child-vm" &&
          c.init.method === "GET",
      ),
  ).toBe(true);
  expect((await f.stores.lifecycle.get(sandbox))?.reference.providerId).toBe(
    "source-vm",
  );
  expect(JSON.stringify(await f.client().get(handle))).not.toContain(
    "synthetic-private",
  );
});

test.each(["lost", "missingId"] as const)(
  "ambiguous fork %s remains unknown with no second native mutation",
  async (failure) => {
    const f = await fixture();
    f.state[failure] = true;
    await f.client().run({ ...handle, kind: "fork" });
    await f.client().run({ ...handle, kind: "fork" });
    expect(await f.client().status(handle)).toMatchObject({
      status: "unknown",
    });
    expect(f.calls).toHaveLength(1);
    expect(f.provider.adapter.images?.find).toBeUndefined();
  },
);

test("foreign fork response cannot publish an unrelated child", async () => {
  const f = await fixture();
  f.state.replyId = "foreign";
  expect(await f.client().run({ ...handle, kind: "fork" })).toMatchObject({
    status: "unknown",
    errorCode: "validation",
  });
});

test.each(["foreign", "missing", "future", "archived"])(
  "uncertain child observation %s retains accepted job without fork replay",
  async (failure) => {
    const f = await fixture();
    await f.client().run({ ...handle, kind: "fork" });
    if (failure === "foreign") f.state.replyId = "foreign";
    else if (failure === "missing") f.state.missing = true;
    else f.state.phase = failure;
    expect(await f.client().status(handle)).toMatchObject({
      status: "unknown",
      nativeImage: { providerOperationId: expect.any(String) },
    });
    expect(f.calls.filter((c) => c.init.method === "POST")).toHaveLength(1);
  },
);

test("native child error is a failed fork without leaking raw errors", async () => {
  const f = await fixture();
  await f.client().run({ ...handle, kind: "fork" });
  f.state.phase = "error";
  expect(await f.client().status(handle)).toMatchObject({ status: "failed" });
});

test("saved template catalog preserves mutable native names and readiness, scoped to the bound source", async () => {
  const f = await fixture();
  const result = await f.client().listTemplates({ sandbox });
  expect(result).toEqual({
    items: [
      {
        reference: { provider: "boat", kind: "template", id: "saving-image" },
        readiness: "pending",
      },
      {
        reference: { provider: "boat", kind: "template", id: "ready-image" },
        readiness: "ready",
      },
      {
        reference: { provider: "boat", kind: "template", id: "failed-image" },
        readiness: "failed",
      },
      {
        reference: { provider: "boat", kind: "template", id: "future-image" },
        readiness: "unknown",
      },
      {
        reference: {
          provider: "boat",
          kind: "template",
          id: "missing-artifact",
        },
        readiness: "unknown",
      },
    ],
    nextCursor: null,
    partial: false,
  });
  expect(JSON.stringify(result)).not.toContain("synthetic-private");
});

test("catalog clipping is partial and no pagination cursor is invented", async () => {
  const f = await fixture();
  expect(await f.client().listTemplates({ sandbox, limit: 1 })).toMatchObject({
    items: [expect.any(Object)],
    partial: true,
    nextCursor: null,
  });
  const count = f.calls.length;
  await expect(
    f.client().listTemplates({ sandbox, cursor: "made-up" }),
  ).rejects.toMatchObject({
    data: { code: "unsupported", outcome: "not_started" },
  });
  expect(f.calls).toHaveLength(count);
});

test.each(["snapshotDisk", "createTemplate", "restore"] as const)(
  "unmapped %s has no destructive substitute or native mutation",
  async (kind) => {
    const f = await fixture();
    await expect(
      f.client().run({
        ...handle,
        kind,
        ...(kind === "restore"
          ? {
              image: {
                provider: "boat",
                kind: "disk-snapshot" as const,
                id: "saved-artifact",
              },
            }
          : {}),
      }),
    ).rejects.toMatchObject({
      data: { code: "unsupported", outcome: "not_started" },
    });
    expect(f.calls).toHaveLength(0);
  },
);

test("job handles cannot be used against another source binding", async () => {
  const f = await fixture();
  const started = await f.client().run({ ...handle, kind: "fork" });
  const status = f.provider.adapter.images?.status;
  if (!status) throw new Error("Missing image status adapter");
  const job = started.nativeImage?.providerOperationId;
  if (!job) throw new Error("Missing native job identity");
  const count = f.calls.length;
  await expect(
    status("other-source", job, {
      idempotencyKey: "status",
      signal: new AbortController().signal,
    }),
  ).rejects.toMatchObject({ data: { code: "validation" } });
  expect(f.calls).toHaveLength(count);
});

test("fork cannot return the source as its new physical identity", async () => {
  const f = await fixture();
  f.state.childId = "source-vm";
  f.state.replyId = "source-vm";
  expect(await f.client().run({ ...handle, kind: "fork" })).toMatchObject({
    status: "unknown",
    errorCode: "validation",
  });
  expect(f.calls).toHaveLength(1);
});

test.each(["duplicate", "invalid"])(
  "malformed native saved names fail catalog projection: %s",
  async (mode) => {
    const f = await fixture();
    if (mode === "duplicate") f.state.catalog[1].name = "saving-image";
    else f.state.catalog[0].name = "https://synthetic-private.example";
    await expect(f.client().listTemplates({ sandbox })).rejects.toMatchObject({
      data: { code: "validation" },
    });
  },
);
