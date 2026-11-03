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
