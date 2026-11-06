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
