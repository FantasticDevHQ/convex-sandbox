import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { retainOwnership, readOwnership } from "./boat-ownership-store.mjs";

async function fixture(t) {
  const dir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "boat-ownership-")),
  );
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const owner = {
    id: "worktree-alpha",
    root: path.join(dir, "checkout"),
    deployment: "anonymous-alpha",
    cloudPort: 19999,
    directory: path.join(dir, "recovery"),
  };
  await fs.mkdir(path.join(owner.root, ".worktree"), { recursive: true });
  await fs.writeFile(
    path.join(owner.root, ".worktree/local.json"),
    JSON.stringify({ version: 1, ...owner, ports: { cloud: owner.cloudPort } }),
  );
  const intent = {
    scope: "example-boat:operator",
    runId: "run",
    operationId: "create-one",
    reservationId: "reservation-one",
    key: "one",
    kind: "create",
    accountId: "account",
    wallet: "personal",
    walletTeamId: null,
    parent: null,
  };
  return { owner, intent };
}
test("intent before dispatch: durable unknown index must succeed first", async (t) => {
  const { owner, intent } = await fixture(t);
  await retainOwnership(owner, intent);
  const [record] = (await readOwnership(owner.directory, owner.id)).intents;
  assert.equal(record.outcome, "unknown");
  assert.equal(record.nativeId, null);
  assert.equal(record.operationId, intent.operationId);
  assert.equal(record.accountId, "account");
});
test("exact ID binding and parent child dependency are immutable", async (t) => {
  const { owner, intent } = await fixture(t);
  const child = {
    ...intent,
    kind: "fork",
    parent: { key: "parent", nativeId: "exact-parent", generation: 7 },
  };
  await retainOwnership(owner, child);
  await retainOwnership(owner, child, {
    nativeId: "exact-returned-child",
    generation: 1,
  });
  await retainOwnership(owner, child);
  const [record] = (await readOwnership(owner.directory, owner.id)).intents;
  assert.equal(record.nativeId, "exact-returned-child");
  assert.deepEqual(record.parent, child.parent);
  await assert.rejects(
    retainOwnership(owner, child, { nativeId: "replacement" }),
  );
  await assert.rejects(
    retainOwnership(owner, { ...child, accountId: "other" }),
  );
});
test("unknown reply: recovery never guesses an ID or dispatches", async (t) => {
  const { owner, intent } = await fixture(t);
  await retainOwnership(owner, intent);
  await retainOwnership(owner, intent);
  assert.equal(
    (await readOwnership(owner.directory, owner.id)).intents[0].outcome,
    "unknown",
  );
});
test("missing checkout: external recovery survives removal", async (t) => {
  const { owner, intent } = await fixture(t);
  await retainOwnership(owner, intent);
  await fs.rm(owner.root, { recursive: true });
  assert.equal(
    (await readOwnership(owner.directory, owner.id)).intents[0].operationId,
    intent.operationId,
  );
  await assert.rejects(retainOwnership(owner, intent));
});
test("concurrent writers retain all intents and filter secret fields", async (t) => {
  const { owner, intent } = await fixture(t);
  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      retainOwnership(owner, {
        ...intent,
        operationId: `create-${i}`,
        reservationId: `r-${i}`,
        apiKey: "do-not-export",
        viewerToken: "do-not-export",
      }),
    ),
  );
  const data = await readOwnership(owner.directory, owner.id);
  assert.equal(data.intents.length, 20);
  assert.ok(!JSON.stringify(data).includes("do-not-export"));
});
test("foreign identity, symlinks and an index inside checkout fail closed", async (t) => {
  const { owner, intent } = await fixture(t);
  await assert.rejects(retainOwnership({ ...owner, id: "foreign" }, intent));
  await assert.rejects(
    retainOwnership(
      { ...owner, directory: path.join(owner.root, "recovery") },
      intent,
    ),
  );
  await fs.symlink(owner.root, owner.directory);
  await assert.rejects(retainOwnership(owner, intent));
});
