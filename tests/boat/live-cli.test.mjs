import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, stat, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "boat-cli-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const planPath = path.join(dir, "plan.json"),
    inventory = path.join(dir, "inventory.jsonl");
  const plan = {
    version: 1,
    runId: "7a5c3575-e084-4e24-8c47-c7f348278178",
    accountId: "synthetic-account",
    approved: true,
    expiresAt: new Date(Date.now() + 1800000).toISOString(),
    machineType: "small",
    maxMachines: 1,
    maxSeconds: 60,
    ttlSeconds: 60,
    budgetUsd: 1,
    estimatedTotalUsd: 0.5,
    acknowledgeUnboundedCleanupCost: true,
  };
  await writeFile(planPath, JSON.stringify(plan));
  const trap = path.join(dir, "trap.mjs");
  await writeFile(
    trap,
    'globalThis.fetch = () => { process.stderr.write("NETWORK_CALLED"); throw new Error("offline only"); };',
  );
  const executeWith = (loader, extraEnv, ...args) => {
    const env = { ...process.env };
    delete env.BOAT_API_KEY;
    Object.assign(env, extraEnv);
    const result = spawnSync(
      process.execPath,
      ["--import", loader, "scripts/boat/live-cli.mjs", ...args],
      { encoding: "utf8", env, timeout: 10000 },
    );
    assert.equal(result.error, undefined);
    assert.doesNotMatch(result.stderr, /NETWORK_CALLED/);
    return result;
  };
  return {
    execute: (...args) => executeWith(trap, {}, ...args),
    executeWith,
    dir,
    plan,
    planPath,
    inventory,
  };
}

test("default CLI refuses live work and shows explicit modes", async (t) => {
  const f = await fixture(t);
  const result = f.execute();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--check-plan/);
  assert.match(result.stderr, /--approved-run/);
});

test("plan validation needs no key, inventory or provider request", async (t) => {
  const f = await fixture(t);
  const result = f.execute("--check-plan", f.planPath);
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).valid, true);
  await assert.rejects(stat(f.inventory), { code: "ENOENT" });
});

test("live mode requires an exact run acknowledgement before reading credentials", async (t) => {
  const f = await fixture(t);
  const result = f.execute(
    "--live",
    f.planPath,
    f.inventory,
    "--approved-run",
    "wrong-run",
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /approval/);
  await assert.rejects(stat(f.inventory), { code: "ENOENT" });
});

test("approved syntax without credentials still refuses before opening an inventory", async (t) => {
  const f = await fixture(t);
  const result = f.execute(
    "--live",
    f.planPath,
    f.inventory,
    "--approved-run",
    f.plan.runId,
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /credential/);
  await assert.rejects(stat(f.inventory), { code: "ENOENT" });
});

test("unknown or extra arguments cannot accidentally enter live mode", async (t) => {
  const f = await fixture(t);
  for (const args of [
    ["--live", f.planPath, f.inventory],
    ["--check-plan", f.planPath, "--live"],
    ["--report", "missing", "--live"],
  ]) {
    const result = f.execute(...args);
    assert.equal(result.status, 1);
    await assert.rejects(stat(f.inventory), { code: "ENOENT" });
  }
});

test("read-only report reconstructs unresolved fixtures without keys or API calls", async (t) => {
  const f = await fixture(t);
  const { createInventory } = await import("../../scripts/boat/live-guard.mjs");
  const inventory = createInventory(f.inventory, f.plan);
  const intent = inventory.reserve(f.plan.accountId, "create");
  inventory.created(intent, "synthetic-owned-vm");
  inventory.close();
  const result = f.execute("--report", f.inventory);
  assert.equal(result.status, 2);
  const report = JSON.parse(result.stdout);
  assert.equal(report.readOnly, true);
  assert.equal(report.qualification, "unverified");
  assert.equal(report.fixtures[0].providerId, "synthetic-owned-vm");
  assert.equal(report.fixtures[0].cleanup, "not-requested");
  assert.doesNotMatch(result.stdout, /accountId|budgetUsd/);
});

for (const signal of ["SIGINT", "SIGTERM", "SIGKILL"]) {
  test(`actual CLI preserves owned inventory on ${signal} with synthetic HTTP only`, async (t) => {
    const f = await fixture(t);
    const loader = path.join(f.dir, "signal-preload.mjs");
    // Entire native boundary is synthetic. No fallthrough to the actual fetch.
    await writeFile(
      loader,
      `
      const accountId = ${JSON.stringify(f.plan.accountId)};
      const json = (body) => new Response(JSON.stringify({ok:true, ...body}));
      globalThis.fetch = async (url, init = {}) => {
        const p = new URL(String(url)).pathname;
        if (p === '/api/v1/me') return json({user:{id:accountId}});
        if (p === '/api/v1/limits') return json({canStart:true,activeSandboxes:0,maxActiveSandboxes:10});
        if (p === '/api/v1/sandboxes') return json({sandbox:{id:'synthetic-owned-vm',state:'ready'}});
        if (p === '/api/v1/sandboxes/synthetic-owned-vm' && init.method === 'DELETE') {
          return json({operation:{id:'synthetic-delete-job',kind:'sandbox',targetId:'synthetic-owned-vm',status:'completed'}});
        }
        if (p === '/api/v1/sandboxes/synthetic-owned-vm') return json({sandbox:{id:'synthetic-owned-vm',state:'ready'}});
        if (p === '/api/v1/sandboxes/synthetic-owned-vm/files' && init.method === 'PUT') {
          process.kill(process.pid, ${JSON.stringify(signal)});
          await new Promise((resolve) => setTimeout(resolve, 20));
          throw new Error('synthetic-private-error');
        }
        throw new Error('Unexpected synthetic request');
      };
    `,
    );
    const result = f.executeWith(
      loader,
      { BOAT_API_KEY: "synthetic-cli-key" },
      "--live",
      f.planPath,
      f.inventory,
      "--approved-run",
      f.plan.runId,
    );
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /synthetic-cli-key|synthetic-private-error/,
    );
    if (signal === "SIGKILL") {
      assert.equal(result.signal, "SIGKILL");
      const inspected = f.execute("--report", f.inventory);
      assert.equal(inspected.status, 2);
      const fixture = JSON.parse(inspected.stdout).fixtures[0];
      assert.equal(fixture.providerId, "synthetic-owned-vm");
      assert.equal(fixture.cleanup, "not-requested");
    } else {
      assert.equal(result.status, 1);
      const report = JSON.parse(result.stdout);
      assert.equal(report.checksPassed, false);
      assert.equal(
        report.fixtures[0].cleanup,
        "vm-deleted-snapshots-unverified",
      );
      assert.equal(report.fixtures[0].deletionJobId, "synthetic-delete-job");
    }
  });
}
