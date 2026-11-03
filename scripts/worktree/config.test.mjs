import { test } from "node:test";
import assert from "node:assert/strict";
import { childEnv } from "./config.mjs";

test("Vite receives the owned backend URL instead of an inherited cloud selector", () => {
  const before = process.env.VITE_CONVEX_URL;
  process.env.VITE_CONVEX_URL = "https://example.invalid";
  try {
    const env = childEnv({ ports: { web: 18000, cloud: 18001, site: 18002 } });
    assert.equal(env.VITE_CONVEX_URL, "http://127.0.0.1:18001");
  } finally {
    if (before === undefined) delete process.env.VITE_CONVEX_URL;
    else process.env.VITE_CONVEX_URL = before;
  }
});
