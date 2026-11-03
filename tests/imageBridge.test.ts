import { convexTest } from "convex-test";
import { defineSchema } from "convex/server";
import { expect, test } from "vitest";
import { register } from "@fantastic.dev/convex-sandbox/testing";
import { internal } from "../example/convex/_generated/api.js";

test("separate host actions recover native image readiness without persisting connection credentials", async () => {
  const t = convexTest(defineSchema({}), {
    "./_generated/server.js": () =>
      import("../example/convex/_generated/server.js"),
    "./proof.ts": () => import("../example/convex/proof.js"),
  });
  const c = register(t);
  expect(await t.action(internal.proof.images, {})).toEqual({
    pending: true,
    connected: true,
    unsupportedDesktop: true,
  });
  expect(await t.action(internal.proof.imageStatus, {})).toEqual({
    ready: true,
    nativeIdentity: true,
  });
  const operations = await t.query(c.operations.list, {
    sandbox: { scope: "internal-fixture", key: "images-proof" },
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(JSON.stringify(operations)).not.toContain(
    "synthetic-connection-secret",
  );
  expect(JSON.stringify(operations)).not.toContain("https:");
});
