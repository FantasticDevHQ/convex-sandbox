import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateArtifactPaths,
  candidateMetadata,
} from "../scripts/release/artifact.mjs";

test("artifact allowlist accepts distribution/docs and rejects local, source and evidence files", () => {
  validateArtifactPaths([
    "package/dist/client/index.js",
    "package/dist/client/index.d.ts",
    "package/docs/quickstart.md",
    "package/CHANGELOG.md",
    "package/assets/brand/logo-mark.svg",
    "package/package.json",
  ]);
  for (const file of [
    "package/.env",
    "package/.worktree/local.json",
    "package/src/client/index.ts",
    "package/dist/.env",
    "package/docs/proof.png",
    "package/dist/../secret.js",
    "package/node_modules/a.js",
    "package/docs/private.json",
    "package/dist/index.js.map",
  ])
    assert.throws(() => validateArtifactPaths([file]));
});
test("candidate metadata identifies source/content and never claims publication or verified provenance", () => {
  const value = candidateMetadata(
    {
      name: "@fantastic.dev/convex-sandbox",
      version: "0.1.0-rc.0",
      private: true,
    },
    {
      sourceCommit: "a".repeat(40),
      lockfileSha256: "b".repeat(64),
      file: "candidate.tgz",
      sha256: "c".repeat(64),
      bytes: 123,
    },
  );
  assert.equal(value.registry.published, false);
  assert.equal(value.registry.availability, "unverified");
  assert.equal(
    value.provenance,
    "unsigned metadata; verify workflow attestation separately",
  );
  assert.equal(value.artifact.sha256, "c".repeat(64));
  assert.throws(() =>
    candidateMetadata({ name: "test", version: "1.0.0", private: true }, {}),
  );
  assert.throws(() =>
    candidateMetadata(
      { name: "test", version: "0.1.0-rc.0", private: false },
      {},
    ),
  );
});

test("candidate output cannot overwrite checkout files or existing directories", async (t) => {
  const { mkdtemp, writeFile, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { spawnSync, execFileSync } = await import("node:child_process");
  const fixture = await mkdtemp(path.join(tmpdir(), "candidate-source-"));
  const existing = await mkdtemp(path.join(tmpdir(), "candidate-existing-"));
  t.after(async () => {
    await rm(existing, { recursive: true, force: true });
    await rm(fixture, { recursive: true, force: true });
  });
  await writeFile(path.join(existing, "keep.txt"), "owned test marker");
  await writeFile(
    path.join(fixture, "package.json"),
    JSON.stringify({
      name: "candidate-fixture",
      version: "0.1.0-rc.0",
      private: true,
    }),
  );
  const git = (...args) =>
    execFileSync("git", args, { cwd: fixture, stdio: "pipe" });
  git("init");
  git("add", "package.json");
  git(
    "-c",
    "user.name=Release fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "fixture",
  );
  const script = path.resolve("scripts/release/candidate.mjs");
  const inside = spawnSync(
    process.execPath,
    [script, path.join(fixture, "candidate")],
    { cwd: fixture, encoding: "utf8" },
  );
  assert.notEqual(inside.status, 0);
  assert.match(inside.stderr, /outside the checkout/);
  const occupied = spawnSync(process.execPath, [script, existing], {
    cwd: fixture,
    encoding: "utf8",
  });
  assert.notEqual(occupied.status, 0);
  assert.match(occupied.stderr, /EEXIST/);
  assert.equal(
    await readFile(path.join(existing, "keep.txt"), "utf8"),
    "owned test marker",
  );
});

test("candidate workflow is manual/default-branch only and separates build from attestation authority", async () => {
  const { readFile } = await import("node:fs/promises");
  const text = await readFile(
    ".github/workflows/release-candidate.yml",
    "utf8",
  );
  assert.match(text, /workflow_dispatch:/);
  assert.doesNotMatch(
    text,
    /pull_request:|push:|NPM_TOKEN|NODE_AUTH_TOKEN|npm publish|pnpm publish|gh release create/,
  );
  assert.match(
    text,
    /github\.ref == format\('refs\/heads\/\{0\}', github\.event\.repository\.default_branch\)/,
  );
  const build = text.slice(text.indexOf("  build:"), text.indexOf("  attest:"));
  assert.doesNotMatch(build, /id-token: write|attestations: write/);
  assert.match(build, /pnpm check:all/);
  const attest = text.slice(text.indexOf("  attest:"));
  assert.doesNotMatch(attest, /actions\/checkout|run:/);
  assert.match(attest, /needs: build/);
  assert.equal(
    (text.match(/runs-on: ubicloud-standard-2-ubuntu-2404/g) ?? []).length,
    2,
  );
});
