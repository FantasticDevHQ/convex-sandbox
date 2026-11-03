import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prepareCheckout } from "./prepare.mjs";

test("prepare builds inside the selected checkout without a shell", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "sandbox-prepare-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  prepareCheckout(root, [
    process.execPath,
    "-e",
    'require("node:fs").writeFileSync("built", "ready")',
  ]);
  assert.equal(await readFile(path.join(root, "built"), "utf8"), "ready");
});
test("missing prepare configuration does not launch a process", () => {
  assert.doesNotThrow(() => prepareCheckout("/not-a-checkout", undefined));
});
test("invalid prepare commands and failing builds stop setup", () => {
  for (const value of [[], "pnpm build", [""], ["node", 1]])
    assert.throws(
      () => prepareCheckout(process.cwd(), value),
      /prepareCommand/,
    );
  assert.throws(() =>
    prepareCheckout(process.cwd(), [process.execPath, "-e", "process.exit(7)"]),
  );
});
