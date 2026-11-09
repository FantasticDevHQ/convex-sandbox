import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectDisplayedSamples,
  assertNoCredentialValues,
} from "../../scripts/check-example-docs.mjs";
import { checkSamples } from "../../scripts/check-docs.mjs";
test("public samples: every displayed host module compiles against public exports", async () => {
  const samples = await collectDisplayedSamples();
  assert.equal(samples.length, 6);
  const result = await checkSamples(samples);
  assert.equal(result.status, 0, result.output);
});
test("no credentials: displayed sources contain no hardcoded credential values", async () => {
  for (const sample of await collectDisplayedSamples())
    assert.doesNotThrow(
      () => assertNoCredentialValues(sample.source),
      sample.name,
    );
  assert.doesNotThrow(() =>
    assertNoCredentialValues(
      'const apiKey = "<BOAT_API_KEY>"; const token = process.env.SERVER_TOKEN;',
    ),
  );
  for (const source of [
    'const apiKey = "hardcoded-value";',
    'const provider = { apiKey: "hardcoded-value" };',
    'const token = "ghp_0123456789example";',
    'import { x } from "@fantastic.dev/convex-sandbox/dist/private.js";',
    'import sdk from "@boatdev/sdk";',
  ])
    assert.throws(() => assertNoCredentialValues(source));
});
test("public samples: unavailable package symbols fail compilation", async () => {
  const [sample] = await collectDisplayedSamples();
  const result = await checkSamples([
    {
      ...sample,
      source:
        sample.source +
        '\nimport { MissingExampleExport } from "@fantastic.dev/convex-sandbox"; export const missing = MissingExampleExport;',
    },
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /MissingExampleExport/);
});

test("server setup: checked walkthrough compiles with a server-only credential boundary", async () => {
  const { collectSamples } = await import("../../scripts/check-docs.mjs");
  const { readFile } = await import("node:fs/promises");
  const samples = (await collectSamples()).filter((sample) =>
    sample.name.startsWith("example-walkthrough.md-"),
  );
  assert.equal(samples.length, 1);
  const result = await checkSamples(samples);
  assert.equal(result.status, 0, result.output);
  const source = samples[0].source;
  assert.match(source, /await requireOperator\(ctx\)/);
  assert.match(source, /process\.env\.BOAT_API_KEY/);
  assert.match(source, /from "@fantastic.dev\/convex-sandbox\/boat"/);
  assert.doesNotMatch(
    source,
    /import\.meta\.env|VITE_|return\s+(?:apiKey|\{[^}]*apiKey)/,
  );
  assertNoCredentialValues(source);
  const frontend = await readFile(
    new URL("../../example/.env.example", import.meta.url),
    "utf8",
  );
  const variables = [...frontend.matchAll(/^#?\s*(VITE_[A-Z_]+)\s*=/gm)].map(
    (match) => match[1],
  );
  assert.deepEqual(variables, [
    "VITE_CONVEX_URL",
    "VITE_CLERK_PUBLISHABLE_KEY",
  ]);
});

test("fresh simulator guide: commands match the adopted lifecycle", async () => {
  const { readFile } = await import("node:fs/promises");
  const guide = await readFile(
    new URL("../../docs/example-walkthrough.md", import.meta.url),
    "utf8",
  );
  const block = guide.match(
    /<!-- checked-simulator-commands -->\n```sh\n([\s\S]*?)```/,
  );
  assert.ok(block, "Fresh-start commands must remain explicitly checked");
  assert.deepEqual(block[1].trim().split("\n"), [
    "pnpm install --frozen-lockfile",
    "pnpm worktree:setup",
    "pnpm worktree:start --frontend",
  ]);
  const manifest = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    manifest.scripts["worktree:setup"],
    "node scripts/worktree/cli.mjs setup",
  );
  assert.equal(
    manifest.scripts["worktree:start"],
    "node scripts/worktree/cli.mjs start",
  );
  assert.match(guide, /Reset then archives\nonly the completed view/);
  assert.match(guide, /while any child or deletion is unknown\/pending/);
  assert.match(guide, /FantasticDev/);
  assert.match(guide, /Unverified/);
});
