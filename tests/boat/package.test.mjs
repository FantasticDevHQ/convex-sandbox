import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("Boat is an exact optional peer, never a mandatory core dependency", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  );
  assert.equal(manifest.peerDependencies["@boatdev/sdk"], "1.13.0");
  assert.equal(manifest.devDependencies["@boatdev/sdk"], "1.13.0");
  assert.equal(manifest.peerDependenciesMeta["@boatdev/sdk"].optional, true);
  assert.equal(manifest.dependencies?.["@boatdev/sdk"], undefined);
  assert.equal(manifest.exports["./boat"].types, "./dist/boat/index.d.ts");
});

test("public core/testing/server/config imports reject both Boat SDK and adapter runtime loads", () => {
  const code = `
    import { registerHooks } from 'node:module';
    registerHooks({ resolve(specifier, context, next) {
      if (specifier === '@boatdev/sdk' || specifier.startsWith('@boatdev/sdk/')) throw Error('Forbidden Boat SDK load');
      const result = next(specifier, context);
      if (result.url.includes('/dist/boat/')) throw Error('Forbidden Boat adapter load');
      return result;
    } });
    await import(process.argv[1]);
  `;
  for (const suffix of [
    "",
    "/testing",
    "/server",
    "/convex.config.js",
    "/_generated/component.js",
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        code,
        `@fantastic.dev/convex-sandbox${suffix}`,
      ],
      { encoding: "utf8", timeout: 10000 },
    );
    assert.equal(result.status, 0, result.stderr);
  }
});
