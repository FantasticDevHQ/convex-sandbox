import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fakeBoatHTTP } from "./live-fixture.mjs";
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
async function fixture(t, options = {}) {
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("Live network forbidden");
  });
  const dir = await mkdtemp(path.join(tmpdir(), "boat-runner-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const inventoryPath = path.join(dir, "inventory.jsonl");
  const approval = { ...plan(), ...options.plan };
  const { calls, machines, fetch } = fakeBoatHTTP(approval, options);
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

test("adapter smoke covers owned lifecycle/files/commands/fork and reports native cleanup with physical erasure unverified", async (t) => {
  const f = await fixture(t);
  const report = await f.run();
  assert.equal(report.checksPassed, true, JSON.stringify(report));
  assert.equal(report.cleanupVerified, true);
  assert.equal(report.qualification, "smoke-passed");
  assert.equal(report.physicalDataErasureVerified, false);
  assert.equal(
    report.cleanupScope,
    "owned-native-sandboxes-snapshots-and-content-records",
  );
  assert.equal(report.fixtures.length, 2);
  assert.ok(
    report.fixtures.every(
      (item) => item.cleanup === "native-deletion-completed",
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
  assert.equal(report.fixtures[0].cleanup, "native-deletion-completed");
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

test("smoke creates no independent snapshot artifacts and deletes only its two owned machines", async (t) => {
  const f = await fixture(t);
  const report = await f.run();
  assert.equal(report.cleanupVerified, true);
  assert.deepEqual(
    f.calls
      .filter((c) => c.method !== "GET")
      .map((c) => `${c.method} ${c.p.join("/")}`),
    [
      "POST sandboxes",
      "PUT sandboxes/owned-1/files",
      "POST sandboxes/owned-1/commands",
      "POST sandboxes/owned-1/stop",
      "POST sandboxes/owned-1/fork",
      "POST sandboxes/owned-1/resume",
      "DELETE sandboxes/owned-1/files",
      "DELETE sandboxes/owned-2",
      "DELETE sandboxes/owned-1",
    ],
  );
});

test("VM-ready observation waits for guest file readiness before any write", async (t) => {
  const f = await fixture(t, { guestFailures: 2, forkGuestFailures: 1 });
  const report = await f.run();
  assert.equal(report.checksPassed, true, JSON.stringify(report));
  const writeAt = f.calls.findIndex((c) => c.method === "PUT");
  assert.equal(
    f.calls
      .slice(0, writeAt)
      .filter((c) => c.p[1] === "owned-1" && c.p[3] === "list").length,
    3,
  );
  assert.equal(f.calls.filter((c) => c.method === "PUT").length, 1);
  assert.equal(report.guestReadinessRetries, 3);
  assert.equal(report.cleanupVerified, true);
});

test("guest readiness exhaustion dispatches no file writes and still cleans the owned VM", async (t) => {
  const f = await fixture(t, { guestFailures: 100 });
  const report = await f.run();
  assert.equal(report.checksPassed, false);
  assert.equal(f.calls.filter((c) => c.method === "PUT").length, 0);
  assert.equal(f.calls.filter((c) => c.p[3] === "list").length, 30);
  assert.equal(report.cleanupVerified, true);
});

test("terminal guest permission errors are reported safely without retries", async (t) => {
  const f = await fixture(t, { failFiles: true });
  const report = await f.run();
  assert.equal(report.failures[0].stage, "guest-file-readiness");
  assert.equal(report.failures[0].errorCode, "authorization");
  assert.equal(f.calls.filter((c) => c.p[3] === "list").length, 1);
  assert.equal(f.calls.filter((c) => c.method === "PUT").length, 0);
  assert.doesNotMatch(JSON.stringify(report), /synthetic-private/);
});

test("fork uses a stopped source snapshot and a retained home fixture, then resume preserves it", async (t) => {
  const f = await fixture(t, { resumeGuestFailures: 2 });
  const report = await f.run();
  assert.equal(report.checksPassed, true, JSON.stringify(report));
  const write = f.calls.find((c) => c.method === "PUT");
  assert.equal(write.body.path, `/home/user/csb-live-${f.approval.runId}.txt`);
  const stopAt = f.calls.findIndex((c) => c.p[2] === "stop");
  const stopStatusAt = f.calls.findIndex((c) => c.p[2] === "stops");
  const forkAt = f.calls.findIndex((c) => c.p[2] === "fork");
  const resumeAt = f.calls.findIndex((c) => c.p[2] === "resume");
  const removeAt = f.calls.findIndex(
    (c) => c.method === "DELETE" && c.p[2] === "files",
  );
  assert.ok(
    stopAt < stopStatusAt &&
      stopStatusAt < forkAt &&
      forkAt < resumeAt &&
      resumeAt < removeAt,
  );
  assert.ok(report.checks.includes("stopped-source-snapshot"));
  assert.ok(report.checks.includes("fork-file-copy"));
  assert.ok(report.checks.includes("resume-file-copy"));
  assert.equal(report.guestReadinessRetries, 2);
  assert.equal(report.cleanupVerified, true);
});

test("currently drained log pages keep polling until the exited fixture's exact bytes arrive", async (t) => {
  const f = await fixture(t, { delayedLogReads: 2 });
  const report = await f.run();
  assert.equal(report.checksPassed, true, JSON.stringify(report));
  assert.equal(report.cleanupVerified, true);
  const reads = f.calls.filter((c) => c.p[4] === "logs");
  assert.equal(reads.length, 6);
  assert.equal(
    f.calls.filter((c) => c.method === "POST" && c.p[2] === "commands").length,
    1,
  );
});

test("unexpected log bytes fail exact smoke verification and still clean only owned fixtures", async (t) => {
  const f = await fixture(t, { unexpectedLogBytes: true });
  const report = await f.run();
  assert.equal(report.checksPassed, false);
  assert.equal(report.cleanupVerified, true);
  assert.ok(report.failures.some((f) => f.stage === "command-logs"));
  assert.equal(report.fixtures.length, 1);
});

test("missing fixture output exhausts bounded log reads and preserves owned cleanup", async (t) => {
  const f = await fixture(t, { delayedLogReads: 100 });
  const report = await f.run();
  assert.equal(report.checksPassed, false);
  assert.equal(report.cleanupVerified, true);
  assert.equal(f.calls.filter((c) => c.p[4] === "logs").length, 90);
  assert.equal(
    f.calls.filter((c) => c.method === "POST" && c.p[2] === "commands").length,
    1,
  );
});
