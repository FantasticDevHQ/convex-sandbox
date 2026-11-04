// Owned anonymous-backend qualification only. Never reads cloud deployment keys.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { state, checkConfig, childEnv, cli } from "../worktree/config.mjs";
import { backend, dir } from "../worktree/context.mjs";

const config = await state();
await checkConfig(config, true);
const env = { ...childEnv(config), FORCE_COLOR: "0" };
delete env.NO_COLOR;
const execute = promisify(execFile);
const controller = new AbortController();
const envArgs = ["--env-file", path.join(dir, "convex.env")];
async function rpc(name) {
  const result = await execute(
    process.execPath,
    [cli(), "run", ...envArgs, name, "{}"],
    {
      cwd: backend,
      env,
      encoding: "utf8",
      timeout: 15000,
      signal: controller.signal,
    },
  );
  return JSON.parse(result.stdout.trim());
}
assert.deepEqual(await rpc("boatReconcileProof:accept"), {
  reversedReply: true,
  bounded: true,
  singleMutation: true,
});
const child = spawn(
  process.execPath,
  [
    cli(),
    "run",
    "--watch",
    ...envArgs,
    "--component",
    "sandbox",
    "registry:get",
    JSON.stringify({
      sandbox: { scope: "boat-reconcile-proof", key: "machine" },
    }),
  ],
  { cwd: backend, env, stdio: ["ignore", "pipe", "pipe"] },
);
let resolveRunning, resolveStopped, fail;
const running = new Promise((resolve) => {
  resolveRunning = resolve;
});
const stopped = new Promise((resolve) => {
  resolveStopped = resolve;
});
const failure = new Promise((_, reject) => {
  fail = reject;
});
let closing = false,
  buffer = "";
const exit = new Promise((resolve) => child.once("exit", resolve));
child.once("error", () => fail(new Error("Owned query watcher failed")));
child.once("exit", () => {
  if (!closing) fail(new Error("Owned query watcher exited early"));
});
child.stderr.resume();
child.stdout.on("data", (data) => {
  buffer = (buffer + data.toString()).slice(-32768);
  if (/["']?observedState["']?\s*:\s*["']running["']/.test(buffer))
    resolveRunning();
  if (/["']?observedState["']?\s*:\s*["']stopped["']/.test(buffer))
    resolveStopped();
});
const timer = setTimeout(
  () => fail(new Error("Owned query watcher timed out")),
  20000,
);
const interrupt = () => fail(new Error("Owned refresh qualifier interrupted"));
process.once("SIGTERM", interrupt);
process.once("SIGINT", interrupt);
try {
  await Promise.race([running, failure]);
  assert.deepEqual(
    await Promise.race([rpc("boatReconcileProof:externalStop"), failure]),
    {
      stopped: true,
      readOnly: true,
    },
  );
  await Promise.race([stopped, failure]);
  console.log(
    JSON.stringify({
      reversedReply: true,
      bounded: true,
      singleMutation: true,
      reactiveExternalStop: true,
      readOnlyRefresh: true,
    }),
  );
} finally {
  clearTimeout(timer);
  process.removeListener("SIGTERM", interrupt);
  process.removeListener("SIGINT", interrupt);
  controller.abort();
  closing = true;
  child.kill("SIGTERM");
  const killTimer = setTimeout(() => child.kill("SIGKILL"), 2000);
  await exit;
  clearTimeout(killTimer);
}
