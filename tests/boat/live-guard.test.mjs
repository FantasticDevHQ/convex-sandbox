import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createInventory,
  readInventory,
  validateApproval,
} from "../../scripts/boat/live-guard.mjs";

const now = Date.parse("2026-11-04T09:00:00Z");
const approval = () => ({
  version: 1,
  runId: "7a5c3575-e084-4e24-8c47-c7f348278178",
  accountId: "synthetic-test-account",
  approved: true,
  expiresAt: "2026-11-04T09:30:00Z",
  machineType: "small",
  maxMachines: 2,
  maxSeconds: 180,
  ttlSeconds: 120,
  budgetUsd: 1,
  estimatedTotalUsd: 0.5,
  acknowledgeUnboundedCleanupCost: true,
});
async function fixture(t, plan = approval()) {
  const dir = await mkdtemp(path.join(tmpdir(), "boat-guard-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "inventory.jsonl");
  const inventory = createInventory(file, plan, () => now);
  t.after(() => inventory.close());
  return { file, inventory };
}

test("missing or invalid approval refuses admission before an inventory exists", () => {
  for (const patch of [
    null,
    {},
    { approved: false },
    { budgetUsd: 0 },
    { budgetUsd: Infinity },
    { estimatedTotalUsd: 2 },
    { maxMachines: 0 },
    { maxMachines: 3 },
    { machineType: "large" },
    { ttlSeconds: 0 },
    { ttlSeconds: 301 },
    { maxSeconds: 601 },
    { maxSeconds: 0 },
    { expiresAt: "2026-11-04T08:00:00Z" },
    { expiresAt: "bad" },
    { acknowledgeUnboundedCleanupCost: false },
    { accountId: "\nprivate" },
    { unexpected: "synthetic-secret" },
  ]) {
    assert.throws(
      () =>
        validateApproval(
          patch === null
            ? null
            : Object.keys(patch).length
              ? { ...approval(), ...patch }
              : {},
          now,
        ),
      /approval/,
    );
  }
  assert.deepEqual(validateApproval(approval(), now), approval());
});

test("mismatched account makes no creation reservation", async (t) => {
  const { file, inventory } = await fixture(t);
  assert.throws(() => inventory.reserve("other-account", "create"), /account/);
  assert.equal(readInventory(file).creations.length, 0);
});

test("creation is durable before native work, and unknown creation blocks further admission", async (t) => {
  const { file, inventory } = await fixture(t);
  const intent = inventory.reserve(approval().accountId, "create");
  assert.equal(readInventory(file).creations[0].intentId, intent);
  assert.equal(readInventory(file).creations[0].providerId, null);
  assert.throws(
    () => inventory.reserve(approval().accountId, "create"),
    /unresolved/,
  );
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.doesNotMatch(await readFile(file, "utf8"), /synthetic-secret/);
});

test("fork requires a confirmed owned parent; lifetime count does not reset after deletion", async (t) => {
  const { file, inventory } = await fixture(t);
  assert.throws(
    () => inventory.reserve(approval().accountId, "fork", "existing-user-vm"),
    /owned/,
  );
  const first = inventory.reserve(approval().accountId, "create");
  inventory.created(first, "owned-one");
  const second = inventory.reserve(approval().accountId, "fork", "owned-one");
  inventory.created(second, "owned-two");
  assert.throws(
    () => inventory.reserve(approval().accountId, "create"),
    /count/,
  );
  assert.equal(readInventory(file).creations.length, 2);
});

test("cleanup cannot target unrelated machines or replay a deletion", async (t) => {
  const { inventory } = await fixture(t);
  assert.throws(() => inventory.deleting("existing-user-vm"), /owned/);
  const intent = inventory.reserve(approval().accountId, "create");
  inventory.created(intent, "owned-one");
  inventory.deleting("owned-one");
  assert.throws(() => inventory.deleting("owned-one"), /already/);
  assert.throws(() => inventory.deleted("owned-one", "wrong-job"), /job/);
});

test("restart reports pending creation and deletion without replaying native writes", async (t) => {
  const { file, inventory } = await fixture(t);
  const intent = inventory.reserve(approval().accountId, "create");
  inventory.created(intent, "owned-one");
  inventory.deleting("owned-one");
  inventory.deletionAccepted("owned-one", "owned-delete-job");
  inventory.close();
  const report = readInventory(file);
  assert.equal(report.creations[0].cleanup, "pending");
  assert.equal(report.creations[0].deletionJobId, "owned-delete-job");
  assert.throws(() => createInventory(file, approval(), () => now), /exist/);
});

test("cleanup requires matching deletion proof; snapshot cleanup remains separately unresolved", async (t) => {
  const { file, inventory } = await fixture(t);
  const intent = inventory.reserve(approval().accountId, "create");
  inventory.created(intent, "owned-one");
  inventory.deleting("owned-one");
  inventory.deletionAccepted("owned-one", "owned-delete-job");
  assert.throws(() => inventory.deleted("owned-one", "wrong-job"), /job/);
  inventory.deleted("owned-one", "owned-delete-job");
  assert.equal(
    readInventory(file).creations[0].cleanup,
    "vm-deleted-snapshots-unverified",
  );
});

test("clock expiry and closed inventory refuse new admissions", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "boat-clock-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let clock = now;
  const inventory = createInventory(
    path.join(dir, "run"),
    approval(),
    () => clock,
  );
  t.after(() => inventory.close());
  clock += 181000;
  assert.throws(
    () => inventory.reserve(approval().accountId, "create"),
    /deadline/,
  );
  inventory.close();
  assert.throws(
    () => inventory.reserve(approval().accountId, "create"),
    /closed/,
  );
});

test("completed VM deletion cannot reclaim the lifetime machine allowance", async (t) => {
  const { inventory } = await fixture(t, { ...approval(), maxMachines: 1 });
  const intent = inventory.reserve(approval().accountId, "create");
  inventory.created(intent, "owned-one");
  inventory.deleting("owned-one");
  inventory.deletionAccepted("owned-one", "owned-job");
  inventory.deleted("owned-one", "owned-job");
  assert.throws(
    () => inventory.reserve(approval().accountId, "create"),
    /count/,
  );
  assert.throws(
    () => inventory.reserve(approval().accountId, "fork", "owned-one"),
    /count/,
  );
});

test("invalid or duplicate creation replies leave the unknown intent visible", async (t) => {
  const { file, inventory } = await fixture(t);
  const first = inventory.reserve(approval().accountId, "create");
  assert.throws(() => inventory.created(first, "secret\nvalue"), /creation/);
  assert.equal(readInventory(file).creations[0].providerId, null);
  inventory.created(first, "owned-one");
  const second = inventory.reserve(approval().accountId, "create");
  assert.throws(() => inventory.created(second, "owned-one"), /creation/);
  assert.equal(readInventory(file).creations[1].providerId, null);
});

test("truncated inventory reports unresolved cleanup without exposing its content", async (t) => {
  const { file, inventory } = await fixture(t);
  inventory.close();
  const { appendFile } = await import("node:fs/promises");
  await appendFile(file, '{"synthetic-secret":');
  assert.throws(
    () => readInventory(file),
    (error) => {
      assert.match(error.message, /cleanup remains unresolved/);
      assert.doesNotMatch(error.message, /synthetic-secret/);
      return true;
    },
  );
});

test("inventory path cannot reuse or follow an existing file", async (t) => {
  const { file, inventory } = await fixture(t);
  inventory.close();
  const { symlink } = await import("node:fs/promises");
  const before = await readFile(file, "utf8");
  const link = `${file}.link`;
  await symlink(file, link);
  assert.throws(() => createInventory(link, approval(), () => now));
  assert.throws(() => readInventory(link), /cleanup remains unresolved/);
  assert.equal(await readFile(file, "utf8"), before);
});

test("invalid budget creates no inventory and performs no network work", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "boat-no-approval-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "run");
  assert.throws(
    () => createInventory(file, { ...approval(), budgetUsd: 0 }, () => now),
    /approval/,
  );
  await assert.rejects(stat(file), { code: "ENOENT" });
});

test("admission clock rollback fails closed while cleanup remains available after expiry", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "boat-late-cleanup-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "run");
  let clock = now;
  const inventory = createInventory(file, approval(), () => clock);
  t.after(() => inventory.close());
  const intent = inventory.reserve(approval().accountId, "create");
  inventory.created(intent, "owned-one");
  clock -= 1;
  assert.throws(
    () => inventory.reserve(approval().accountId, "create"),
    /deadline/,
  );
  clock = now + 181000;
  assert.throws(
    () => inventory.reserve(approval().accountId, "create"),
    /deadline/,
  );
  inventory.deleting("owned-one");
  inventory.deletionAccepted("owned-one", "owned-job");
  inventory.deleted("owned-one", "owned-job");
  assert.equal(
    readInventory(file).creations[0].cleanup,
    "vm-deleted-snapshots-unverified",
  );
});

for (const method of ["writeSync", "fsyncSync"]) {
  test(`${method} failure stops all subsequent native admissions without leaking its cause`, async (t) => {
    const { inventory } = await fixture(t);
    const { default: fs } = await import("node:fs");
    const { syncBuiltinESMExports } = await import("node:module");
    t.mock.method(fs, method, () => {
      throw new Error("synthetic-private-storage-error");
    });
    syncBuiltinESMExports();
    try {
      assert.throws(
        () => inventory.reserve(approval().accountId, "create"),
        (error) => {
          assert.equal(
            error.message,
            "Inventory persistence failed; stop native work",
          );
          return true;
        },
      );
    } finally {
      t.mock.restoreAll();
      syncBuiltinESMExports();
    }
    assert.throws(
      () => inventory.reserve(approval().accountId, "create"),
      /closed/,
    );
  });
}

test("restart retains an unresolved creation even without a native ID", async (t) => {
  const { file, inventory } = await fixture(t);
  const intentId = inventory.reserve(approval().accountId, "create");
  inventory.close();
  assert.deepEqual(readInventory(file).creations, [
    {
      intentId,
      kind: "create",
      parentId: null,
      providerId: null,
      deletionJobId: null,
      cleanup: "not-requested",
    },
  ]);
});
