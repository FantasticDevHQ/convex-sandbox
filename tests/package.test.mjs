import { spawnSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";

test("core, component config and generated references resolve from public package exports", async () => {
  const core = await import("@fantastic.dev/convex-sandbox");
  const config = await import("@fantastic.dev/convex-sandbox/convex.config.js");
  const testing = await import("@fantastic.dev/convex-sandbox/testing");
  await import("@fantastic.dev/convex-sandbox/_generated/component.js");
  assert.equal(typeof core.SandboxBoundary, "function");
  assert.ok(config.default);
  assert.equal(typeof testing.register, "function");
});

test("server helpers fail browser imports while Convex resolution remains available", () => {
  const browser = spawnSync(
    process.execPath,
    [
      "--conditions=browser",
      "--input-type=module",
      "-e",
      "await import('@fantastic.dev/convex-sandbox/server')",
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(browser.status, 0);
  assert.match(browser.stderr, /server-only/);
  const convex = spawnSync(
    process.execPath,
    [
      "--conditions=browser",
      "--conditions=convex",
      "--input-type=module",
      "-e",
      "const { createHostAccess } = await import('@fantastic.dev/convex-sandbox/server'); if (typeof createHostAccess !== 'function') process.exit(1)",
    ],
    { encoding: "utf8" },
  );
  assert.equal(convex.status, 0, convex.stderr);
});

test("core and testing entry graphs do not load React or test-runner runtime dependencies", () => {
  const code = `
    import { registerHooks } from "node:module";
    registerHooks({ resolve(specifier, context, next) {
      if (/^(react(?:$|\\/)|react-dom(?:$|\\/)|vitest(?:$|\\/)|convex-test(?:$|\\/))/.test(specifier)) throw new Error("Forbidden runtime dependency");
      const result = next(specifier, context);
      if (process.argv[2] === "core" && result.url.includes("/dist/testing/")) throw new Error("Core loaded test fixtures");
      return result;
    } });
    await import(process.argv[1]);
  `;
  for (const [entry, mode] of [
    ["@fantastic.dev/convex-sandbox", "core"],
    ["@fantastic.dev/convex-sandbox/testing", "testing"],
  ]) {
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", code, entry, mode],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
  }
});
