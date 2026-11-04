import { convexTest } from "convex-test";
import { defineSchema } from "convex/server";
import { expect, test } from "vitest";
import { register } from "@fantastic.dev/convex-sandbox/testing";
import { internal } from "../example/convex/_generated/api.js";

test("separate host actions resume a persisted native lifecycle job through the actual store bridge", async () => {
  const t = convexTest(defineSchema({}), {
    "./_generated/server.js": () =>
      import("../example/convex/_generated/server.js"),
    "./nativeLifecycleProof.ts": () =>
      import("../example/convex/nativeLifecycleProof.js"),
  });
  register(t);
  expect(await t.action(internal.nativeLifecycleProof.accept, {})).toEqual({
    stored: true,
    pending: true,
    singleDispatch: true,
    jobRead: true,
  });
  expect(await t.action(internal.nativeLifecycleProof.complete, {})).toEqual({
    completed: true,
    tombstone: true,
    jobRead: true,
    notRedispatched: true,
  });
});
