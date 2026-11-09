// Test-only local bridge. Never included in the production Convex function tree.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { state, checkConfig, cli, childEnv, convexArgs } from "./config.mjs";
import { backend, dir, configFile, registry } from "./context.mjs";
import { stopOnly, start, run, ownedRunning } from "./processes.mjs";
import { readOwnership } from "./boat-ownership-store.mjs";

const suffix = process.argv[2];
assert.ok(["alpha", "beta"].includes(suffix));
const s = await state();
await checkConfig(s, true);
const withFrontend = (await ownedRunning(s))?.frontend ?? false;
const config = JSON.parse(await fs.readFile(configFile, "utf8"));
const url = `http://127.0.0.1:${s.ports.cloud}`;
const client = new ConvexHttpClient(url);
client.setAdminAuth(config.adminKey);
const original = new Map(
  (
    await client.query(
      makeFunctionReference("_system/cli/queryEnvironmentVariables"),
      {},
    )
  ).map((row) => [row.name, row.value]),
);
const qualificationScope = `ownership-qualification-${randomUUID()}`;
const fullScope = `example-boat:${qualificationScope}`;
const identity = {
  issuer: "https://ownership-qualification.invalid",
  subject: "synthetic-operator",
};
const bridge = path.join(backend, "convex/ownershipRuntimeFixture.ts");
const source =
  'export { dispatch, recover } from "../fixtures/ownershipRuntime";\n';
const owner = JSON.parse(original.get("EXAMPLE_WORKTREE_OWNERSHIP"));
assert.equal(owner.id, s.id);
async function env(changes) {
  const response = await fetch(`${url}/api/update_environment_variables`, {
    method: "POST",
    headers: {
      Authorization: `Convex ${config.adminKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ changes }),
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 200, "Owned backend environment update failed");
}
function rpc(name, args, auth = identity) {
  const result = spawnSync(
    process.execPath,
    [
      cli(),
      "run",
      "--env-file",
      path.join(dir, "convex.env"),
      ...(auth ? ["--identity", JSON.stringify(auth)] : []),
      name.includes(":") ? name : `ownershipRuntimeFixture:${name}`,
      JSON.stringify(args),
    ],
    {
      cwd: backend,
      env: childEnv(s),
      encoding: "utf8",
      timeout: 30000,
    },
  );
  if (result.status !== 0) throw Error(result.stderr.slice(-3000));
  return result.stdout.trim() ? JSON.parse(result.stdout.trim()) : null;
}
let installed = false,
  configured = false;
try {
  // wx preserves any existing user file. Only our exact temporary bridge may be removed.
  await stopOnly(s);
  await fs.writeFile(bridge, source, { flag: "wx", mode: 0o600 });
  installed = true;
  await run(convexArgs(s, ["--once"]), s);
  await start(withFrontend);
  await env([
    {
      name: "EXAMPLE_OPERATOR_GRANTS",
      value: JSON.stringify([{ ...identity, scope: qualificationScope }]),
    },
  ]);
  configured = true;
  const retained = rpc("live/allowance:proposal", {}).approval;
  const plan = retained?.plan ?? {
    runId: `ownership-qualification-${suffix}`,
    scope: fullScope,
    accountId: "synthetic-qualification-account",
    wallet: "personal",
    walletTeamId: null,
    size: "small",
    expiresAt: Date.now() + 600000,
    maxMachines: 2,
    maxStarts: 2,
    maxConcurrent: 2,
    durationMinutes: 10,
    estimateUsd: 0.1,
    allowanceUsd: 1,
  };
  assert.equal(
    plan.runId,
    `ownership-qualification-${suffix}`,
    "Never replace a retained qualification run",
  );
  await env([{ name: "EXAMPLE_LIVE_RUN_PLAN", value: JSON.stringify(plan) }]);
  for (const unknown of [false, true]) {
    const status = unknown ? "unknown" : "succeeded";
    const before = rpc("live/create:status", {
      key: unknown ? "ownership-unknown" : "ownership-known",
    });
    assert.deepEqual(rpc("dispatch", { unknown }), {
      calls: before.reservationHeld ? 0 : 1,
      status,
    });
    rpc("recover", {
      key: unknown ? "ownership-unknown" : "ownership-known",
      kind: "create",
    });
    assert.deepEqual(rpc("dispatch", { unknown }), { calls: 0, status });
  }
  console.log(
    "PASS: production wrapper -> Node action -> operator authority query -> external index; exact ID and lost reply; one synthetic dispatch each",
  );
  assert.throws(() =>
    rpc("recover", { key: "ownership-known", kind: "create" }, null),
  );
  assert.throws(() =>
    rpc(
      "recover",
      { key: "ownership-known", kind: "create" },
      { ...identity, subject: "foreign" },
    ),
  );
  await env([
    {
      name: "EXAMPLE_WORKTREE_OWNERSHIP",
      value: JSON.stringify({ ...owner, cloudPort: owner.cloudPort + 1 }),
    },
  ]);
  assert.throws(() =>
    rpc("recover", { key: "ownership-known", kind: "create" }),
  );
  await env([
    { name: "EXAMPLE_WORKTREE_OWNERSHIP", value: JSON.stringify(owner) },
  ]);
  console.log(
    "PASS: anonymous identity, foreign identity and mismatched backend URL refused",
  );
  await stopOnly(s);
  await start(withFrontend);
  rpc("recover", { key: "ownership-unknown", kind: "create" });
  const index = await readOwnership(
    path.join(await fs.realpath(registry), "boat-ownership"),
    s.id,
  );
  assert.equal(
    index.intents.find(
      (r) => r.scope === fullScope && r.key === "ownership-known",
    ).nativeId,
    "synthetic-ownership-known",
  );
  assert.equal(
    index.intents.find(
      (r) => r.scope === fullScope && r.key === "ownership-known",
    ).generation,
    1,
  );
  assert.equal(
    index.intents.find(
      (r) => r.scope === fullScope && r.key === "ownership-unknown",
    ).nativeId,
    null,
  );
  assert.equal(
    index.intents.find(
      (r) => r.scope === fullScope && r.key === "ownership-unknown",
    ).outcome,
    "unknown",
  );
  assert.deepEqual(rpc("dispatch", { unknown: true }), {
    calls: 0,
    status: "unknown",
  });
  console.log(
    "PASS: exact ID/generation and original unknown survive actual managed restart and production recovery without redispatch",
  );
} catch (error) {
  // Capture the owned supervisor diagnostic before restoration replaces its log.
  if (error.message?.includes("Backend exited")) {
    const log = await fs.readFile(path.join(dir, "backend.log"), "utf8");
    throw Error(`${error.message}\n${log.slice(-5000)}`, { cause: error });
  }
  throw error;
} finally {
  if (installed) {
    await stopOnly(s);
    assert.equal(
      await fs.readFile(bridge, "utf8"),
      source,
      "Refusing to remove a changed test bridge",
    );
    await fs.rm(bridge);
    // Regenerate/push the original production function set; no public bridge remains.
    await run(convexArgs(s, ["--once"]), s);
    await start(withFrontend);
    console.log(
      "PASS: temporary test bridge removed, original environment restored and production bindings regenerated",
    );
  }
  if (configured)
    await env(
      [
        "EXAMPLE_WORKTREE_OWNERSHIP",
        "EXAMPLE_OPERATOR_GRANTS",
        "EXAMPLE_LIVE_RUN_PLAN",
      ].map((name) => ({ name, value: original.get(name) ?? null })),
    );
}
