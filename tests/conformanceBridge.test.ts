import { convexTest } from "convex-test";
import { defineSchema } from "convex/server";
import { expect, test } from "vitest";
import { register } from "@fantastic.dev/convex-sandbox/testing";
import { internal } from "../example/convex/_generated/api.js";

test("exported conformance cases run through a host action and installed component", async () => {
  const t = convexTest(defineSchema({}), {
    "./_generated/server.js": () =>
      import("../example/convex/_generated/server.js"),
    "./proof.ts": () => import("../example/convex/proof.js"),
  });
  register(t);
  expect(await t.action(internal.proof.conformance, {})).toEqual({
    passed: 13,
    skipped: 0,
    total: 13,
  });
});
