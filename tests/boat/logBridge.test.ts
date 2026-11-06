import { convexTest } from "convex-test";
import { defineSchema } from "convex/server";
import { expect, test } from "vitest";
import { register } from "@fantastic.dev/convex-sandbox/testing";
import { internal } from "../../example/convex/_generated/api.js";

test("Boat runtime proof keeps drained cursors readable through fresh actions", async () => {
  const t = convexTest(defineSchema({}), {
    "./_generated/server.js": () =>
      import("../../example/convex/_generated/server.js"),
    "./boatLogProof.ts": () => import("../../example/convex/boatLogProof.js"),
  });
  register(t);
  expect(await t.action(internal.boatLogProof.encoding, {})).toEqual({
    utf8: true,
    boundaryReread: true,
  });
  expect(await t.action(internal.boatLogProof.accept, {})).toEqual({
    cached: true,
    repeatedRead: true,
    cancellationUnsupported: true,
  });
  expect(await t.action(internal.boatLogProof.complete, {})).toEqual({
    noDuplicates: true,
    resumedOffsets: true,
    notCompletion: true,
    cursorReadable: true,
  });
});
