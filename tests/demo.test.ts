import { convexTest } from "convex-test";
import { expect, test, beforeEach, afterEach, vi } from "vitest";
import { register } from "@fantastic.dev/convex-sandbox/testing";
import { api, internal } from "../example/convex/_generated/api.js";
import schema from "../example/convex/schema.js";

beforeEach(() => vi.stubEnv("CONVEX_SITE_URL", "http://127.0.0.1:3211"));
afterEach(() => vi.unstubAllEnvs());
function fixture() {
  const t = convexTest(schema, {
    "./_generated/server.js": () =>
      import("../example/convex/_generated/server.js"),
    "./demo.ts": () => import("../example/convex/demo.js"),
    "./demo/store.ts": () => import("../example/convex/demo/store.js"),
  });
  register(t);
  return t;
}

test("seed is repeatable and reactive queries return actual component state", async () => {
  const t = fixture();
  expect((await t.query(api.demo.info, {})).initialized).toBe(false);
  const seeded = await t.action(api.demo.seed, {});
  expect(await t.action(api.demo.seed, {})).toEqual(seeded);
  const rows = await t.query(api.demo.list, {});
  expect(rows.page.map((row) => row.key).sort()).toEqual([
    "ephemeral",
    "memory",
    "persistent",
  ]);
  expect(rows.page.every((row) => row.observedState === "running")).toBe(true);
  await t.action(api.demo.lifecycle, {
    profile: "persistent",
    action: "stop",
    operationId: "stop",
  });
  expect(
    (await t.query(api.demo.get, { profile: "persistent" }))?.observedState,
  ).toBe("stopped");
  await t.action(api.demo.lifecycle, {
    profile: "persistent",
    action: "start",
    operationId: "start",
  });
  expect(
    (await t.query(api.demo.get, { profile: "persistent" }))?.observedState,
  ).toBe("running");
});

test("fresh actions recover persisted unknown execution outcomes and cache real fixture logs", async () => {
  const t = fixture();
  await t.action(api.demo.seed, {});
  const unknown = await t.action(api.demo.execute, {
    profile: "persistent",
    operationId: "lost",
    scenario: "lost-reply",
  });
  expect(unknown.state).toBe("unknown");
  expect(
    (
      await t.query(api.demo.execution, {
        profile: "persistent",
        operationId: "lost",
      })
    )?.state,
  ).toBe("unknown");
  expect(
    (
      await t.action(api.demo.status, {
        profile: "persistent",
        operationId: "lost",
      })
    )?.state,
  ).toBe("completed");
  const logs = await t.query(api.demo.logs, {
    profile: "persistent",
    operationId: "lost",
    cursor: null,
  });
  expect(logs.entries.map((entry) => entry.text).join("")).toBe(
    "Hello from convex-sandbox.\n",
  );
});

test("file writes survive action boundaries and reset creates a clean fixture epoch", async () => {
  const t = fixture();
  const first = await t.action(api.demo.seed, {});
  await t.action(api.demo.writeFile, {
    profile: "persistent",
    path: "/workspace/note.txt",
    text: "fixture note",
    operationId: "write",
  });
  expect(
    (
      await t.action(api.demo.readFile, {
        profile: "persistent",
        path: "/workspace/note.txt",
      })
    ).text,
  ).toBe("fixture note");
  expect(
    (await t.query(api.demo.files, { profile: "persistent" })).some(
      (file) => file.path === "/workspace/note.txt",
    ),
  ).toBe(true);
  const reset = await t.action(api.demo.reset, {});
  expect(reset.epoch).toBeGreaterThan(first.epoch);
  expect(
    (await t.query(api.demo.files, { profile: "persistent" })).some(
      (file) => file.path === "/workspace/note.txt",
    ),
  ).toBe(false);
  expect((await t.query(api.demo.list, {})).page).toHaveLength(3);
});

test("unsupported capabilities and fixture connection metadata remain explicit", async () => {
  const t = fixture();
  await t.action(api.demo.seed, {});
  expect(
    (await t.query(api.demo.capabilities, { profile: "ephemeral" })).supported,
  ).not.toContain("getConnection");
  await expect(
    t.action(api.demo.connection, { profile: "ephemeral", kind: "desktop" }),
  ).rejects.toThrow();
  expect(
    await t.action(api.demo.connection, { profile: "memory", kind: "desktop" }),
  ).toMatchObject({
    mode: "simulation",
    functional: false,
    handle: { kind: "desktop" },
  });
});

test("arbitrary commands and provider/owner configuration are rejected", async () => {
  const t = fixture();
  await t.action(api.demo.seed, {});
  await expect(
    t.action(api.demo.execute, {
      profile: "persistent",
      operationId: "bad",
      scenario: "rm -rf /",
    } as never),
  ).rejects.toThrow();
  await expect(
    t.query(api.demo.get, {
      profile: "persistent",
      scope: "other-owner",
      provider: "live",
    } as never),
  ).rejects.toThrow();
  await expect(
    t.action(api.demo.writeFile, {
      profile: "persistent",
      path: "/workspace/../private",
      text: "bad",
      operationId: "bad-path",
    }),
  ).rejects.toThrow();
});

test("cloud-like deployments cannot enable local fixture endpoints", async () => {
  vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");
  const t = fixture();
  await expect(t.action(api.demo.seed, {})).rejects.toThrow();
  await expect(t.query(api.demo.info, {})).rejects.toThrow();
});

test("fixture leases reject competing mutations and fence stale checkpoints", async () => {
  const t = fixture();
  const lease = await t.mutation(internal.demo.store.acquire, { reset: false });
  await expect(
    t.mutation(internal.demo.store.acquire, { reset: false }),
  ).rejects.toThrow();
  await t.mutation(internal.demo.store.release, {
    epoch: lease.epoch,
    token: lease.token,
  });
  const next = await t.mutation(internal.demo.store.acquire, { reset: true });
  await expect(
    t.mutation(internal.demo.store.complete, {
      epoch: lease.epoch,
      token: lease.token,
    }),
  ).rejects.toThrow();
  await t.mutation(internal.demo.store.release, {
    epoch: next.epoch,
    token: next.token,
  });
});

test("memory stop/resume and cancellation preserve their distinct component states", async () => {
  const t = fixture();
  await t.action(api.demo.seed, {});
  await t.action(api.demo.lifecycle, {
    profile: "memory",
    action: "stop",
    operationId: "pause",
  });
  expect(
    (await t.query(api.demo.get, { profile: "memory" }))?.observedState,
  ).toBe("paused");
  await t.action(api.demo.lifecycle, {
    profile: "memory",
    action: "start",
    operationId: "resume",
  });
  expect(
    (await t.query(api.demo.get, { profile: "memory" }))?.observedState,
  ).toBe("running");
  const job = await t.action(api.demo.execute, {
    profile: "persistent",
    operationId: "background",
    scenario: "background",
  });
  expect(job.state).toBe("queued");
  const acknowledgement = await t.action(api.demo.cancel, {
    profile: "persistent",
    operationId: "background",
  });
  expect(acknowledgement).toMatchObject({
    state: "queued",
    cancellation: { requested: true, acknowledgement: "accepted" },
  });
  expect(
    (
      await t.action(api.demo.status, {
        profile: "persistent",
        operationId: "background",
      })
    )?.state,
  ).toBe("cancelled");
  expect(
    (
      await t.query(api.demo.logs, {
        profile: "persistent",
        operationId: "background",
        cursor: null,
      })
    ).entries,
  ).toHaveLength(0);
});

test("public snapshot demo persists pending image state and reconciles via history", async () => {
  const t = fixture();
  await t.action(api.demo.seed, {});
  const pending = await t.action(api.demo.snapshot, {
    profile: "memory",
    operationId: "snapshot-demo",
  });
  expect(pending.status).toBe("running");
  const ready = await t.action(api.demo.snapshotStatus, {
    profile: "memory",
    operationId: "snapshot-demo",
  });
  expect(ready?.status).toBe("succeeded");
  const history = await t.query(api.demo.history, {
    profile: "memory",
    paginationOpts: { cursor: null, numItems: 10 },
  });
  expect(
    history.page.some(
      (row) => row.kind === "snapshotDisk" && row.status === "succeeded",
    ),
  ).toBe(true);
});

test("large fixture output exposes multiple bounded reactive cache pages", async () => {
  const t = fixture();
  await t.action(api.demo.seed, {});
  await t.action(api.demo.execute, {
    profile: "persistent",
    operationId: "pages",
    scenario: "large-output",
  });
  const first = await t.query(api.demo.logs, {
    profile: "persistent",
    operationId: "pages",
    cursor: null,
  });
  expect(first.entries).toHaveLength(2);
  expect(first.isDone).toBe(false);
  const next = await t.query(api.demo.logs, {
    profile: "persistent",
    operationId: "pages",
    cursor: first.nextCursor,
  });
  expect(next.entries.length).toBeGreaterThan(0);
  expect(next.entries[0]?.sequence).toBeGreaterThan(
    first.entries[1]?.sequence ?? -1,
  );
});
