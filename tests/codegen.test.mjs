import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { assertGeneratedClean } from "../scripts/check-codegen.mjs";

test("codegen rejects changed, deleted and new bindings but ignores other source", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "sandbox-codegen-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe" });
  const generated = "src/component/_generated/api.ts";
  mkdirSync(path.dirname(path.join(root, generated)), { recursive: true });
  writeFileSync(path.join(root, generated), "original");
  git("init");
  git("add", ".");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-m",
    "fixture",
  );
  assertGeneratedClean(root);
  writeFileSync(path.join(root, "other.ts"), "unrelated");
  assertGeneratedClean(root);
  writeFileSync(path.join(root, generated), "stale");
  assert.throws(() => assertGeneratedClean(root), /Generated bindings differ/);
  git("add", generated);
  assert.throws(() => assertGeneratedClean(root), /Generated bindings differ/);
  git("restore", "--staged", generated);
  git("restore", generated);
  rmSync(path.join(root, generated));
  assert.throws(() => assertGeneratedClean(root), /Generated bindings differ/);
  git("restore", generated);
  writeFileSync(path.join(root, "src/component/_generated/new.ts"), "new");
  assert.throws(() => assertGeneratedClean(root), /Generated bindings differ/);
});
