// Adapted upstream qualification: exercise the installed component with the local CLI.
// Internal probes and the public local-only example use synthetic data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import net from "node:net";
import { existsSync } from "node:fs";
import { installDependencies } from "./dependencies.mjs";
import { refreshCheckout } from "./freshness.mjs";
import { mountPackedComponent } from "../release/packed-component.mjs";

const source = await realpath(process.cwd());
const layout = JSON.parse(
  await readFile(path.join(source, "scripts/worktree.config.json"), "utf8"),
);
const backendPath = layout.backend || ".";
const hasApp = existsSync(path.join(source, backendPath, "convex.json"));
function run(cwd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["scripts/worktree/cli.mjs", ...args],
      {
        cwd,
        env: { ...process.env, CI: "true" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, output }));
  });
}
async function ok(cwd, ...args) {
  const r = await run(cwd, args);
  assert.equal(r.code, 0, r.output.slice(-8000));
  return r;
}
async function componentRpc(root, fn, args, host = false) {
  const code = `
    import { spawnSync } from "node:child_process";
    import path from "node:path";
    import { state, checkConfig, childEnv, cli } from "./scripts/worktree/config.mjs";
    import { backend, dir } from "./scripts/worktree/context.mjs";
    const s = await state(); await checkConfig(s, true);
    const componentArgs = process.argv[3] === "host" ? [] : ["--component", "sandbox"];
    const result = spawnSync(process.execPath, [cli(), "run", "--env-file", path.join(dir, "convex.env"), ...componentArgs, process.argv[1], process.argv[2]], {cwd:backend, env:childEnv(s), encoding:"utf8"});
    if (result.status !== 0) throw new Error("Local component RPC failed: " + result.stderr.slice(-2000));
    const text = result.stdout.trim();
    process.stdout.write(text ? JSON.stringify(JSON.parse(text)) : "null");
  `;
  const output = execFileSync(
    process.execPath,
    ["--input-type=module", "-e", code, fn, JSON.stringify(args), host ? "host" : "component"],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30000,
    },
  );
  return JSON.parse(output);
}
const identity = { scope: "qualification", key: "same-key" };
function readObservation(root) {
  return componentRpc(root, "observations:get", identity);
}
function writeObservation(root, value) {
  return componentRpc(root, "observations:record", {
    ...identity,
    provider: "simulated",
    providerId: value,
    state: "running",
  });
}
async function frontendReady(s) {
  const response = await fetch(`http://127.0.0.1:${s.ports.web}`, {
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /src\/main\.tsx/);
}

test(
  "two real worktrees: isolated component state, Vite ports, restart and safe cleanup",
  {
    timeout: 600000,
    skip: hasApp ? false : "Run from this Convex component repository",
  },
  async (t) => {
    const selectedBase = await refreshCheckout(source, {
      refreshCurrent: false,
    });
    assert.ok(
      selectedBase,
      "Qualification requires a Git checkout and live origin base.",
    );
    const testedHead = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: source,
      encoding: "utf8",
    }).trim();
    execFileSync(
      "git",
      ["merge-base", "--is-ancestor", selectedBase, testedHead],
      { cwd: source },
    );
    const patch = execFileSync(
      "git",
      ["diff", "--binary", selectedBase, testedHead],
      { cwd: source },
    );
    const base = await realpath(
      await mkdtemp(path.join(tmpdir(), "convex-worktree-e2e-")),
    );
    const roots = ["alpha", "beta"].map((name) => path.join(base, name));
    t.after(async () => {
      let safeToRemove = true;
      for (const root of roots) {
        if (!existsSync(root)) continue;
        const result = await run(root, ["cleanup", "--yes"]).catch((error) => ({
          code: 1,
          output: error.message,
        }));
        if (result.code) {
          safeToRemove = false;
          console.error(
            "Cleanup limitation; temporary checkout preserved:",
            root,
            result.output,
          );
        } else
          execFileSync("git", ["worktree", "remove", "--force", root], {
            cwd: source,
            stdio: "ignore",
          });
      }
      execFileSync("git", ["worktree", "prune"], { cwd: source });
      if (safeToRemove) await rm(base, { recursive: true, force: true });
    });
    for (const root of roots) {
      execFileSync("git", ["worktree", "add", "--detach", root, selectedBase], {
        cwd: source,
        stdio: "ignore",
      });
      // Start at the fetched immutable base, then apply the candidate's tracked
      // delta in this disposable checkout. Never copy local state or credentials.
      if (patch.length) {
        execFileSync("git", ["apply", "--index"], { cwd: root, input: patch });
        execFileSync(
          "git",
          [
            "-c",
            "user.name=Sandbox qualification",
            "-c",
            "user.email=qualification@example.invalid",
            "commit",
            "-m",
            "test: apply candidate for disposable qualification",
          ],
          { cwd: root, stdio: "ignore" },
        );
      }
      installDependencies(root);
    }
    await mountPackedComponent(roots[0], base);
    console.log("PASS: first anonymous host resolves the packed component instead of workspace source");
    const setups = await Promise.allSettled(
      roots.map((root) => ok(root, "setup")),
    );
    for (const result of setups)
      if (result.status === "rejected") throw result.reason;
    const states = await Promise.all(
      roots.map((root) =>
        readFile(path.join(root, ".worktree/local.json"), "utf8").then(
          JSON.parse,
        ),
      ),
    );
    assert.notEqual(states[0].id, states[1].id);
    const configs = await Promise.all(
      roots.map((root) =>
        readFile(
          path.join(
            root,
            path.join(backendPath, ".convex/local/default/config.json"),
          ),
          "utf8",
        ).then(JSON.parse),
      ),
    );
    assert.ok(
      configs[0].adminKey !== configs[1].adminKey,
      "Local admin credentials must be distinct",
    );
    assert.equal(
      new Set(states.flatMap((s) => Object.values(s.ports))).size,
      6,
    );
    console.log(
      "PASS: parallel setup, distinct deployment identities, six distinct reserved ports",
    );
    await Promise.all(roots.map((root) => ok(root, "start", "--frontend")));
    await Promise.all(states.map(frontendReady));
    for (const root of roots) assert.deepEqual(await componentRpc(root, "boatProbe:runtime", {}, true), {
      injectedFetch: true, requestInputs: true, detachedCommand: true,
      abortForwarded: true, lostReplyNotRetried: true, httpErrorsNotRetried: true,
    });
    console.log("PASS: pinned Boat SDK bundles and runs in anonymous Convex V8 with synthetic fetch, abort propagation and no mutation replay");
    for (const root of roots) assert.deepEqual(await componentRpc(root, "boatProbe:transport", {}, true), {
      projection: true, accountScoped: true, aborted: true, noRawErrors: true,
    });
    console.log("PASS: optional public Boat adapter entry projects observations, scopes the account and handles aborts without leaking raw errors on both anonymous backends");
    for (const root of roots) assert.deepEqual(await componentRpc(root, "boatProbe:provision", {}, true), {
      createdOnce: true, safeDefaults: true, stableKey: true,
      pendingThenReady: true, unknownNotReplayed: true, resourcesProjected: true,
    });
    console.log("PASS: Boat provisioning uses shared claims, safe guest defaults and bounded stable keys; lost replies remain unknown without a repeated POST on both anonymous backends");
    for (const root of roots) assert.deepEqual(await componentRpc(root, "nativeLifecycleProof:accept", {}, true), {
      stored: true, pending: true, singleDispatch: true, jobRead: true,
    });
    console.log("PASS: generic native lifecycle jobs persist with their operation and reconcile by scoped read-only context on both anonymous backends");
    execFileSync(process.execPath, ["scripts/check-codegen.mjs", "--check"], {
      cwd: roots[0],
      env: {
        ...process.env,
        CI: "true",
        CONVEX_DEPLOYMENT: "prod:qualification-must-ignore",
        CONVEX_DEPLOY_KEY: "invalid-qualification-key",
        CONVEX_DEPLOYMENT_TOKEN: "invalid-qualification-token",
        CONVEX_SELF_HOSTED_URL: "https://qualification.invalid",
        CONVEX_SELF_HOSTED_ADMIN_KEY: "invalid-qualification-key",
      },
      stdio: "inherit",
      timeout: 120000,
    });
    for (const root of roots) assert.deepEqual(await componentRpc(root, "proof:lifecycle", {}, true), {
      created: true, stopped: true, deleted: true,
    });
    console.log("PASS: internal host lifecycle bridge creates once, stops and deletes synthetic machines on both backends");
    for (const root of roots) assert.deepEqual(await componentRpc(root, "proof:execution", {}, true), {
      startedOnce: true, completed: true, cancelAcknowledged: true, outputBounded: true, deleted: true,
    });
    console.log("PASS: host execution bridge starts once, caches bounded logs and separates cancellation from completion on both backends");
    for (const root of roots) assert.deepEqual(await componentRpc(root, "proof:files", {}, true), {
      text: true, binary: true, listed: true, deleted: true, transferBounded: true, denied: true,
    });
    console.log("PASS: host file bridge preserves text/binary, bounds transfer handles and enforces path policy on both backends");
    for (const root of roots) assert.deepEqual(await componentRpc(root, "proof:images", {}, true), {
      pending: true, connected: true, unsupportedDesktop: true,
    });
    console.log("PASS: host image bridge retains pending native jobs and issues only supported ephemeral connections on both backends");
    for (const root of roots) assert.deepEqual(await componentRpc(root, "proof:hostSecurity", {}, true), {
      deniedAcrossScopes: true, deniedListInjection: true, noUnauthorizedSDKCalls: true, outputWithheld: true, safeError: true, secretHandleBlocked: true,
    });
    console.log("PASS: host authorization denies cross-scope SDK access and keeps output and master keys out of component records on both backends");
    for (const root of roots) assert.deepEqual(await componentRpc(root, "proof:conformance", {}, true), { passed: 13, skipped: 0, total: 13 });
    console.log("PASS: all 13 exported adapter conformance cases pass through the public simulator and installed component on both backends");
    execFileSync(process.execPath, ["../node_modules/@playwright/test/cli.js", "test"], {
      cwd: path.join(roots[0], "example"),
      env: { ...process.env, CSB_LIVE_URL: `http://127.0.0.1:${states[0].ports.web}` },
      stdio: "inherit", timeout: 120000,
    });
    for (const root of roots) execFileSync(process.execPath, ["example/scripts/qualify-backend.mjs"], {
      cwd: root, stdio: "inherit", timeout: 60000,
    });
    await writeObservation(roots[0], "alpha");
    await writeObservation(roots[1], "beta");
    const entries = await Promise.all(roots.map(readObservation));
    assert.deepEqual(
      entries.map((row) => row.providerId),
      ["alpha", "beta"],
    );
    console.log(
      "PASS: two live Vite frontends and isolated component observations under identical logical keys",
    );
    for (const [index, root] of roots.entries()) {
      const binding = await componentRpc(root, "registry:ensure", {
        sandbox: identity,
        reference: { provider: "simulated", providerId: index === 0 ? "alpha" : "beta" },
      });
      const operation = await componentRpc(root, "operations:begin", {
        sandbox: identity,
        expectedVersion: binding.version,
        operationId: "qualification-execution",
        kind: "execute",
      });
      assert.equal(await componentRpc(root, "operations:transition", {
        sandbox: identity,
        operationId: operation.operationId,
        expectedVersion: operation.version,
        status: index === 0 ? "unknown" : "succeeded",
        executionId: index === 0 ? "exec-alpha" : "exec-beta",
      }), true);
      assert.equal(await componentRpc(root, "registry:get", {
        sandbox: { ...identity, scope: "other-scope" },
      }), null);
    }
    console.log("PASS: isolated registry bindings and distinct execution outcomes under identical logical/operation keys");
    for (const root of roots)
      assert.equal(
        execFileSync("git", ["status", "--porcelain"], {
          cwd: root,
          encoding: "utf8",
        }).trim(),
        "",
        "Development must leave tracked and untracked source files untouched",
      );
    const before = await readFile(
      path.join(roots[0], ".worktree/backend.env"),
      "utf8",
    );
    await ok(roots[0], "stop");
    await ok(roots[0], "setup");
    await ok(roots[0], "start", "--frontend");
    await frontendReady(states[0]);
    assert.ok(
      (await readFile(path.join(roots[0], ".worktree/backend.env"), "utf8")) ===
        before,
      "Repeated setup must preserve managed configuration",
    );
    assert.equal((await readObservation(roots[0])).providerId, "alpha");
    const boatBinding = await componentRpc(roots[0], "registry:get", {
      sandbox: { scope: "boat-provision-proof", key: "created" },
    });
    assert.equal(boatBinding.reference.providerId, "synthetic-boat-machine");
    assert.equal(boatBinding.observedState, "running");
    assert.deepEqual(boatBinding.resources, { cpuCount: 2 });
    const boatUnknown = await componentRpc(roots[0], "lifecycle:getProvision", {
      sandbox: { scope: "boat-provision-proof", key: "lost" },
    });
    assert.equal(boatUnknown.status, "unknown");
    assert.equal(boatUnknown.idempotency, "native");
    console.log("PASS: Boat native binding and unknown creation survive anonymous backend restart in the shared component");
    assert.deepEqual(await componentRpc(roots[0], "nativeLifecycleProof:complete", {}, true), {
      completed: true, tombstone: true, jobRead: true, notRedispatched: true,
    });
    const siblingJob = await componentRpc(roots[1], "operations:get", {
      sandbox: { scope: "native-lifecycle-proof", key: "machine" }, operationId: "delete",
    });
    assert.equal(siblingJob.status, "unknown");
    assert.deepEqual(siblingJob.nativeLifecycle, { id: "fixture-native-job" });
    console.log("PASS: native lifecycle job completes after anonymous backend restart without another mutation or crossing into its sibling");
    const commandHandle = { sandbox: { scope: "internal-fixture", key: "execution-proof" }, operationId: "command" };
    const cachedExecution = await componentRpc(roots[0], "execution:get", commandHandle);
    assert.equal(cachedExecution.state, "completed");
    assert.equal(cachedExecution.exitCode, 0);
    assert.equal(cachedExecution.cancellation.acknowledgement, "accepted");
    const cachedLogs = await componentRpc(roots[0], "execution:logs", { ...commandHandle, cursor: null, limit: 16 });
    assert.equal(cachedLogs.entries.map(entry => entry.text).join(""), "synthetic output");
    console.log("PASS: execution handles, completion, cancellation acknowledgement and cached logs survive restart");
    assert.deepEqual(await componentRpc(roots[0], "proof:imageStatus", {}, true), { ready: true, nativeIdentity: true });
    const imageHandle = { sandbox: { scope: "internal-fixture", key: "images-proof" }, operationId: "snapshot" };
    assert.equal((await componentRpc(roots[0], "operations:get", imageHandle)).status, "succeeded");
    assert.equal((await componentRpc(roots[1], "operations:get", imageHandle)).status, "running");
    console.log("PASS: native image readiness resumes in a new host action after restart without crossing worktrees");
    assert.equal((await componentRpc(roots[0], "demo:status", { profile: "persistent", operationId: "restart-lost" }, true)).state, "completed");
    const demoLogs = await componentRpc(roots[0], "demo:logs", { profile: "persistent", operationId: "restart-lost", cursor: null }, true);
    assert.equal(demoLogs.entries.map(entry => entry.text).join(""), "Hello from convex-sandbox.\n");
    assert.equal((await componentRpc(roots[0], "demo:readFile", { profile: "persistent", path: "/workspace/qualification.txt" }, true)).text, "persisted local fixture");
    assert.equal((await componentRpc(roots[1], "demo:execution", { profile: "persistent", operationId: "restart-lost" }, true)).state, "unknown");
    const siblingInfo = await componentRpc(roots[1], "demo:info", {}, true);
    const resetDemo = await componentRpc(roots[0], "demo:reset", {}, true);
    assert.ok(resetDemo.epoch > siblingInfo.epoch);
    assert.equal((await componentRpc(roots[0], "demo:list", {}, true)).page.length, 3);
    assert.equal((await componentRpc(roots[0], "demo:files", { profile: "persistent" }, true)).some(file => file.path === "/workspace/qualification.txt"), false);
    assert.equal((await componentRpc(roots[1], "demo:info", {}, true)).epoch, siblingInfo.epoch);
    console.log("PASS: public example recovers unknown execution and files after restart; reset leaves sibling fixture untouched");
    const restored = await componentRpc(roots[0], "registry:get", { sandbox: identity });
    assert.equal(restored.reference.providerId, "alpha");
    assert.equal(restored.activeOperationId, "qualification-execution");
    const execution = await componentRpc(roots[0], "operations:get", {
      sandbox: identity, operationId: "qualification-execution",
    });
    assert.equal(execution.status, "unknown");
    assert.equal(execution.executionId, "exec-alpha");
    assert.equal((await componentRpc(roots[1], "operations:get", {
      sandbox: identity, operationId: "qualification-execution",
    })).status, "succeeded");
    console.log("PASS: registry binding and unknown execution reservation survive backend restart without crossing worktrees");
    assert.deepEqual(
      JSON.parse(
        await readFile(path.join(roots[0], ".worktree/local.json"), "utf8"),
      ),
      states[0],
    );
    console.log(
      "PASS: repeated setup/restart preserves database, identity, ports and generated configuration",
    );
    await ok(roots[0], "teardown");
    await frontendReady(states[1]);
    assert.equal((await readObservation(roots[1])).providerId, "beta");
    await ok(roots[0], "start", "--frontend");
    await frontendReady(states[0]);
    assert.equal((await readObservation(roots[0])).providerId, "alpha");
    console.log(
      "PASS: teardown preserves data, leaves sibling backend running, restart reacquires ports",
    );
    await ok(roots[0], "stop");
    for (const port of [states[0].ports.cloud, states[0].ports.web]) {
      const blocker = net.createServer();
      await new Promise((resolve) => blocker.listen(port, "127.0.0.1", resolve));
      try {
        const r = await run(roots[0], ["start", "--frontend"]);
        assert.notEqual(r.code, 0);
        assert.match(r.output, /busy/);
        assert.equal(blocker.listening, true);
      } finally {
        await new Promise((resolve) => blocker.close(resolve));
      }
    }
    console.log("PASS: occupied backend and frontend ports fail without killing their owner");
    await ok(roots[0], "cleanup", "--yes");
    const cleanedEnv = await readFile(path.join(roots[0], backendPath, ".env.local"), "utf8");
    assert.doesNotMatch(cleanedEnv, /^(VITE_CONVEX_URL|CONVEX_DEPLOYMENT)=/m);
    await assert.rejects(
      readFile(
        path.join(
          roots[0],
          path.join(backendPath, ".convex/local/default/config.json"),
        ),
      ),
      { code: "ENOENT" },
    );
    await ok(roots[0], "cleanup", "--yes");
    await frontendReady(states[1]);
    assert.equal((await readObservation(roots[1])).providerId, "beta");
    console.log(
      "PASS: explicit cleanup removes only the owned database and is repeatable",
    );
  },
);
