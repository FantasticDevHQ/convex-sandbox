import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runLive } from "../../scripts/boat/live-runner.mjs";
import { readInventory } from "../../scripts/boat/live-guard.mjs";

function plan() {
  return {
    version: 1,
    runId: "7a5c3575-e084-4e24-8c47-c7f348278178",
    accountId: "synthetic-test-account",
    approved: true,
    expiresAt: new Date(Date.now() + 1800000).toISOString(),
    machineType: "small",
    maxMachines: 2,
    maxSeconds: 180,
    ttlSeconds: 120,
    budgetUsd: 1,
    estimatedTotalUsd: 0.5,
    acknowledgeUnboundedCleanupCost: true,
  };
}
const json = (body, status = 200) =>
  new Response(JSON.stringify({ ok: true, ...body }), { status });
async function fixture(t, options = {}) {
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("Live network forbidden");
  });
  const dir = await mkdtemp(path.join(tmpdir(), "boat-runner-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const inventoryPath = path.join(dir, "inventory.jsonl");
  const approval = { ...plan(), ...options.plan };
  const calls = [];
  const machines = new Map();
  let number = 0;
  const fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    assert.equal(u.origin, "https://boat.dev");
    assert.equal(new Headers(init.headers).get("X-Boat-Org"), "personal");
    assert.equal(init.redirect, "error");
    const p = u.pathname
      .slice("/api/v1/".length)
      .split("/")
      .map(decodeURIComponent);
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ p, method, body });
    options.onRequest?.(p, method);
    if (options.signal && p[0] === options.signalAt) options.signal.abort();
    if (p[0] === "me")
      return json({
        user: {
          id: options.accountId ?? approval.accountId,
          email: "synthetic-private@example.invalid",
        },
      });
    if (p[0] === "limits") {
      assert.equal(u.searchParams.get("org"), "personal");
      return json({
        canStart: options.canStart ?? true,
        activeSandboxes: options.activeSandboxes ?? 0,
        maxActiveSandboxes: 10,
        ...(options.teamId ? { teamId: options.teamId } : {}),
      });
    }
    if (p[0] === "saved-snapshots") return json({ snapshots: [] });
    if (p[0] === "deletion-operations") {
      const id = p[1].slice("delete-".length);
      return json({
        operation: {
          id: p[1],
          kind: "sandbox",
          targetId: options.wrongTarget ? "existing-user-vm" : id,
          status: options.pendingDeletion ? "pending" : "completed",
        },
      });
    }
    assert.equal(p[0], "sandboxes");
    if (!p[1]) {
      assert.equal(method, "POST");
      assert.equal(body.noEnv, true);
      assert.equal(body.snapshots, true);
      assert.equal(body.type, "small");
      assert.equal(body.visibility, "private");
      assert.equal(body.ttlSeconds, 120);
      if (options.lostCreate) throw new Error("synthetic-private-key-and-body");
      const id = `owned-${++number}`;
      machines.set(id, {
        state: options.neverReady ? "provisioning" : "ready",
        files: new Map(),
      });
      options.acceptedCreate?.();
      return json({ sandbox: { id, state: machines.get(id).state } });
    }
    const id = p[1];
    assert.notEqual(id, "existing-user-vm");
    const machine = machines.get(id);
    assert.ok(machine, `Unexpected target ${id}`);
    if (p[2] === "fork") {
      assert.equal(body.noEnv, true);
      assert.deepEqual(body.env, {});
      if (options.lostFork) throw new Error("synthetic-private-key-and-body");
      const child = `owned-${++number}`;
      machines.set(child, { state: "ready", files: new Map(machine.files) });
      return json({ id: child, sandbox: { id: child, state: "provisioning" } });
    }
    if (p[2] === "stop") {
      machine.state = "archived";
      return json({ id, stop: { id: `stop-${id}`, status: "completed" } });
    }
    if (p[2] === "stops")
      return json({ id, stop: { id: p[3], status: "completed" } });
    if (p[2] === "resume") {
      assert.equal(body.noEnv, true);
      machine.state = "ready";
      return json({ id, sandbox: { id, state: "provisioning" } });
    }
    if (p[2] === "commands") {
      assert.equal(method, "POST");
      assert.equal(body.detached, true);
      assert.match(body.command, /printf/);
      machine.output = `csb-${approval.runId}\n`;
      return json({
        success: true,
        type: "command.started",
        commandId: `cmd-${id}`,
      });
    }
    if (p[2] === "command-history") {
      if (p[4] !== "logs")
        return json({
          command: {
            commandId: p[3],
            sandboxId: id,
            mode: "detached",
            status: "exited",
            exitCode: options.commandFailure ? 1 : 0,
          },
        });
      const stream = u.searchParams.get("stream");
      const content = stream === "stdout" ? machine.output : "";
      const bytes = Buffer.from(content);
      return json({
        commandId: p[3],
        stream,
        encoding: "base64",
        offset: 0,
        nextOffset: bytes.length,
        size: bytes.length,
        data: bytes.toString("base64"),
        done: true,
      });
    }
    if (p[2] === "files") {
      const target = body?.path ?? u.searchParams.get("path");
      assert.ok(
        target === "/tmp" || target === `/tmp/csb-live-${approval.runId}.txt`,
      );
      if (options.failFiles)
        return json({ private: "synthetic-private-key-and-body" }, 403);
      if (p[3] === "list")
        return json({
          success: true,
          path: target,
          truncated: false,
          files: [...machine.files].map(([file, bytes]) => ({
            name: path.basename(file),
            path: file,
            isDir: false,
            isSymlink: false,
            size: bytes.length,
          })),
        });
      if (method === "PUT")
        machine.files.set(target, Buffer.from(body.content, "base64"));
      if (method === "DELETE") {
        machine.files.delete(target);
        return json({ success: true, path: target });
      }
      const bytes = machine.files.get(target);
      return json({
        success: true,
        path: target,
        encoding: "base64",
        size: bytes.length,
        ...(method === "GET" ? { content: bytes.toString("base64") } : {}),
      });
    }
    if (method === "DELETE") {
      if (options.lostDelete) throw new Error("synthetic-private-key-and-body");
      return json(
        {
          operation: {
            id: `delete-${id}`,
            kind: "sandbox",
            targetId: id,
            status: "pending",
          },
        },
        202,
      );
    }
    return json({ sandbox: { id, state: machine.state } });
  };
  return {
    calls,
    machines,
    inventoryPath,
    approval,
    run: (extra = {}) =>
      runLive({
        approval,
        inventoryPath,
        apiKey: "synthetic-live-key",
        fetch,
        pause: async () => {},
        ...extra,
      }),
  };
}

test("adapter smoke covers owned lifecycle/files/commands/fork and reports snapshot cleanup unresolved", async (t) => {
  const f = await fixture(t);
  const report = await f.run();
  assert.equal(report.checksPassed, true, JSON.stringify(report));
  assert.equal(report.cleanupVerified, false);
  assert.equal(report.fixtures.length, 2);
  assert.ok(
    report.fixtures.every(
      (item) => item.cleanup === "vm-deleted-snapshots-unverified",
    ),
  );
  assert.ok(report.checks.includes("detached-command-and-logs"));
  assert.ok(report.checks.includes("stop-and-resume"));
  assert.ok(report.checks.includes("fork-file-copy"));
  assert.ok(report.unsupported.includes("cancelExecution"));
  assert.doesNotMatch(
    JSON.stringify(report),
    /synthetic-private|synthetic-live-key|example.invalid/,
  );
  assert.doesNotMatch(
    await readFile(f.inventoryPath, "utf8"),
    /synthetic-private|synthetic-live-key/,
  );
  assert.equal(
    f.calls.filter((c) => c.method === "DELETE" && c.p.length === 2).length,
    2,
  );
  assert.equal(f.calls.filter((c) => c.p[2] === "resume").length, 1);
});

test("no valid approval admits no provider requests", async (t) => {
  const f = await fixture(t, { plan: { budgetUsd: 0 } });
  await assert.rejects(f.run(), /approval/);
  assert.equal(f.calls.length, 0);
});

for (const options of [
  { accountId: "another-account" },
  { activeSandboxes: 1 },
  { canStart: false },
  { teamId: "another-wallet" },
]) {
  test(`preflight refuses ${JSON.stringify(options)} before creation`, async (t) => {
    const f = await fixture(t, options);
    const report = await f.run();
    assert.equal(report.checksPassed, false);
    assert.equal(report.fixtures.length, 0);
    assert.equal(f.calls.filter((c) => c.method !== "GET").length, 0);
  });
}

test("lost create reply stays unresolved and is neither retried nor guessed for cleanup", async (t) => {
  const f = await fixture(t, { lostCreate: true });
  const report = await f.run();
  assert.equal(report.checksPassed, false);
  assert.equal(report.fixtures[0].providerId, null);
  assert.equal(f.calls.filter((c) => c.method === "POST").length, 1);
  assert.equal(f.calls.filter((c) => c.method === "DELETE").length, 0);
  assert.equal(readInventory(f.inventoryPath).creations.length, 1);
});

test("lost fork reply preserves child intent while deleting only the confirmed owned parent", async (t) => {
  const f = await fixture(t, { lostFork: true });
  const report = await f.run();
  assert.equal(report.checksPassed, false);
  assert.equal(report.fixtures.length, 2);
  assert.equal(report.fixtures[1].providerId, null);
  assert.deepEqual(
    f.calls
      .filter((c) => c.method === "DELETE" && c.p.length === 2)
      .map((c) => c.p[1]),
    ["owned-1"],
  );
});

for (const options of [
  { lostDelete: true },
  { pendingDeletion: true },
  { wrongTarget: true },
]) {
  test(`uncertain cleanup remains pending without deletion replay: ${JSON.stringify(options)}`, async (t) => {
    const f = await fixture(t, options);
    const report = await f.run();
    assert.equal(report.cleanupVerified, false);
    assert.ok(report.fixtures.every((item) => item.cleanup === "pending"));
    assert.equal(
      f.calls.filter((c) => c.method === "DELETE" && c.p.length === 2).length,
      2,
    );
    assert.ok(f.calls.length < 100);
  });
}

for (const options of [
  { failFiles: true },
  { commandFailure: true },
  { neverReady: true },
]) {
  test(`verification failure still attempts owned cleanup: ${JSON.stringify(options)}`, async (t) => {
    const f = await fixture(t, options);
    const report = await f.run();
    assert.equal(report.checksPassed, false);
    assert.equal(
      f.calls.filter((c) => c.method === "DELETE" && c.p.length === 2).length,
      1,
    );
    assert.doesNotMatch(JSON.stringify(report), /synthetic-private/);
  });
}

test("one-machine approval skips fork and admits exactly one creation", async (t) => {
  const f = await fixture(t, { plan: { maxMachines: 1 } });
  const report = await f.run();
  assert.equal(report.checksPassed, true, JSON.stringify(report));
  assert.equal(report.fixtures.length, 1);
  assert.ok(report.skipped.includes("fork-budget"));
  assert.equal(f.calls.filter((c) => c.p[2] === "fork").length, 0);
});

test("abort during work retains confirmed ownership and uses a fresh signal for cleanup", async (t) => {
  const controller = new AbortController();
  const f = await fixture(t, {
    signal: controller,
    signalAt: "saved-snapshots",
  });
  const report = await f.run({ signal: controller.signal });
  assert.equal(report.checksPassed, false);
  assert.ok(f.calls.some((c) => c.method === "DELETE" && c.p[1] === "owned-1"));
});

test("inventory inside the checkout is rejected before preflight", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.run({
      inventoryPath: path.resolve("never-created-live-inventory.jsonl"),
    }),
  );
  assert.equal(f.calls.length, 0);
});

test("pre-aborted work admits no machine", async (t) => {
  const f = await fixture(t);
  const controller = new AbortController();
  controller.abort();
  const report = await f.run({ signal: controller.signal });
  assert.equal(report.fixtures.length, 0);
  assert.equal(f.calls.length, 0);
});

test("failed persistence after accepted creation retains the ID and stops further native work", async (t) => {
  const { default: fs } = await import("node:fs");
  const { syncBuiltinESMExports } = await import("node:module");
  const f = await fixture(t, {
    acceptedCreate: () => {
      t.mock.method(fs, "fsyncSync", () => {
        throw new Error("synthetic-private-storage-error");
      });
      syncBuiltinESMExports();
    },
  });
  let report;
  try {
    report = await f.run();
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
  assert.equal(report.checksPassed, false);
  assert.equal(report.fixtures[0].providerId, "owned-1");
  assert.equal(report.fixtures[0].cleanup, "not-requested");
  assert.equal(f.calls.filter((c) => c.method !== "GET").length, 1);
  assert.doesNotMatch(JSON.stringify(report), /synthetic-private/);
});

test("work expiry after creation refuses subsequent work while confirmed-owned cleanup runs", async (t) => {
  let clock = Date.now();
  const f = await fixture(t, {
    onRequest: (p) => {
      if (p[2] === "commands") clock += 181000;
    },
  });
  const report = await f.run({ clock: () => clock });
  assert.equal(report.checksPassed, false);
  assert.equal(report.fixtures.length, 1);
  assert.equal(report.fixtures[0].cleanup, "vm-deleted-snapshots-unverified");
  assert.equal(
    f.calls.filter((c) => ["fork", "resume"].includes(c.p[2])).length,
    0,
  );
  assert.equal(
    f.calls.filter((c) => c.method === "DELETE" && c.p.length === 2).length,
    1,
  );
});

test("inventory close failure still emits the owned cleanup report without a private exception", async (t) => {
  const { default: fs } = await import("node:fs");
  const { syncBuiltinESMExports } = await import("node:module");
  const f = await fixture(t, {
    acceptedCreate: () => {
      const close = fs.closeSync;
      t.mock.method(fs, "closeSync", (fd) => {
        close(fd);
        throw new Error("synthetic-private-close-error");
      });
      syncBuiltinESMExports();
    },
  });
  let report;
  try {
    await assert.doesNotReject(async () => {
      report = await f.run();
    });
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
  assert.equal(report.fixtures.length, 2);
  assert.ok(report.failures.some((item) => item.stage === "inventory"));
  assert.equal(report.cleanupVerified, false);
  assert.doesNotMatch(JSON.stringify(report), /synthetic-private/);
});
