import { convexTest } from "convex-test";
import { defineSchema } from "convex/server";
import { expect, test } from "vitest";
import { register } from "@fantastic.dev/convex-sandbox/testing";
import { internal } from "../../example/convex/_generated/api.js";

test("Boat provisioning runs through the public factory and actual component store bridge", async () => {
  const t = convexTest(defineSchema({}), {
    "./_generated/server.js": () =>
      import("../../example/convex/_generated/server.js"),
    "./boatProbe.ts": () => import("../../example/convex/boatProbe.js"),
  });
  register(t);
  expect(await t.action(internal.boatProbe.provision, {})).toEqual({
    createdOnce: true,
    safeDefaults: true,
    stableKey: true,
    pendingThenReady: true,
    unknownNotReplayed: true,
    resourcesProjected: true,
  });
});
