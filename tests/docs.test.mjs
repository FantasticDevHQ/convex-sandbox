import { test } from "node:test";
import assert from "node:assert/strict";
import { collectSamples, checkSamples } from "../scripts/check-docs.mjs";

test("quickstart and adapter guide samples compile against public package exports", async () => {
  const samples = await collectSamples();
  assert.ok(samples.length >= 4);
  const result = await checkSamples(samples);
  assert.equal(result.status, 0, result.output);
});

test("documentation gate rejects an unavailable package export", async () => {
  const result = await checkSamples([
    {
      name: "invalid",
      location: "convex/invalid.ts",
      source:
        'import { MissingDocumentationExport } from "@fantastic.dev/convex-sandbox"; export const value = MissingDocumentationExport;',
    },
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /MissingDocumentationExport/);
});

test("README and new guides link to existing local documentation", async () => {
  const { readFile, access } = await import("node:fs/promises");
  const path = await import("node:path");
  for (const file of [
    "README.md",
    "docs/quickstart.md",
    "docs/adapters.md",
    "docs/api.md",
    "docs/integrations.md",
  ]) {
    const text = await readFile(file, "utf8");
    for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^https?:\/\//.test(match[1])) continue;
      const target = match[1].split("#")[0];
      if (target)
        await assert.doesNotReject(
          access(path.resolve(path.dirname(file), target)),
          `Broken local link in ${file}: ${target}`,
        );
    }
  }
});
