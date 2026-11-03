// Runs only inside an owned anonymous checkout created by worktree qualification.
import assert from "node:assert/strict";
import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { state, checkConfig } from "../../scripts/worktree/config.mjs";

const managed = await state();
await checkConfig(managed, true);
const client = new ConvexClient(`http://127.0.0.1:${managed.ports.cloud}`, {
  unsavedChangesWarning: false,
});
const observed = new Set();
let failure;
const waiters = new Set();
const unsubscribe = client.onUpdate(
  api.demo.get,
  { profile: "persistent" },
  (row) => {
    observed.add(row?.observedState ?? "absent");
    for (const wake of waiters) wake();
  },
  (error) => {
    failure = error;
    for (const wake of waiters) wake();
  },
);
function waitFor(value) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => finish(new Error(`Missing reactive state: ${value}`)),
      10000,
    );
    function finish(error) {
      clearTimeout(timeout);
      waiters.delete(check);
      if (error) reject(error);
      else resolve();
    }
    function check() {
      if (failure) finish(failure);
      else if (observed.has(value)) finish();
    }
    waiters.add(check);
    check();
  });
}
try {
  await waitFor("absent");
  const seeded = await client.action(api.demo.seed, {});
  assert.deepEqual(await client.action(api.demo.seed, {}), seeded);
  await waitFor("running");
  await client.action(api.demo.lifecycle, {
    profile: "persistent",
    action: "stop",
    operationId: "qual-stop",
  });
  await waitFor("stopped");
  observed.delete("running");
  await client.action(api.demo.lifecycle, {
    profile: "persistent",
    action: "start",
    operationId: "qual-start",
  });
  await waitFor("running");
  await client.action(api.demo.writeFile, {
    profile: "persistent",
    path: "/workspace/qualification.txt",
    text: "persisted local fixture",
    operationId: "qual-file",
  });
  assert.equal(
    (
      await client.action(api.demo.readFile, {
        profile: "persistent",
        path: "/workspace/qualification.txt",
      })
    ).text,
    "persisted local fixture",
  );
  assert.equal(
    (
      await client.action(api.demo.execute, {
        profile: "persistent",
        operationId: "restart-lost",
        scenario: "lost-reply",
      })
    ).state,
    "unknown",
  );
  assert.equal((await client.query(api.demo.info, {})).mode, "simulation");
  console.log(
    "PASS: repeatable public seed, WebSocket state updates and checkpointed files/unknown execution",
  );
} finally {
  unsubscribe();
  await client.close();
}
