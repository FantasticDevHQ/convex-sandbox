import { convexTest } from "convex-test";
import { defineSchema } from "convex/server";
import { expect, test } from "vitest";
import { register } from "@fantastic.dev/convex-sandbox/testing";
import { internal } from "../../example/convex/_generated/api.js";

test("Boat lifecycle uses native endpoints and resumes deletion by persisted ID in a new action", async () => {
  const t = convexTest(defineSchema({}), {
    "./_generated/server.js": () =>
      import("../../example/convex/_generated/server.js"),
    "./boatLifecycleProof.ts": () =>
      import("../../example/convex/boatLifecycleProof.js"),
  });
  register(t);
  expect(await t.action(internal.boatLifecycleProof.accept, {})).toEqual({
    stopped: true,
    resumed: true,
    pending: true,
    confirmation: true,
    noForcedStop: true,
  });
  expect(await t.action(internal.boatLifecycleProof.complete, {})).toEqual({
    completed: true,
    tombstone: true,
    notRedispatched: true,
  });
});
