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
