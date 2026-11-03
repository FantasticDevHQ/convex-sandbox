// Adapted upstream qualification: exercise the installed component with the local CLI.
// No public probe functions or test-only schema are deployed.
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
async function componentRpc(root, fn, args) {
  const code = `
    import { spawnSync } from "node:child_process";
    import path from "node:path";
    import { state, checkConfig, childEnv, cli } from "./scripts/worktree/config.mjs";
    import { backend, dir } from "./scripts/worktree/context.mjs";
    const s = await state(); await checkConfig(s, true);
    const result = spawnSync(process.execPath, [cli(), "run", "--env-file", path.join(dir, "convex.env"), "--component", "sandbox", process.argv[1], process.argv[2]], {cwd:backend, env:childEnv(s), encoding:"utf8"});
    if (result.status !== 0) throw new Error("Local component RPC failed: " + result.stderr.slice(-2000));
    process.stdout.write(JSON.stringify(JSON.parse(result.stdout)));
  `;
  const output = execFileSync(
    process.execPath,
    ["--input-type=module", "-e", code, fn, JSON.stringify(args)],
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
    const blocker = net.createServer();
    await new Promise((resolve) =>
      blocker.listen(states[0].ports.cloud, "127.0.0.1", resolve),
    );
    try {
      const r = await run(roots[0], ["start"]);
      assert.notEqual(r.code, 0);
      assert.match(r.output, /busy/);
      assert.equal(blocker.listening, true);
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
    console.log(
      "PASS: occupied port causes explicit failure without killing its owner",
    );
    await ok(roots[0], "cleanup", "--yes");
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
