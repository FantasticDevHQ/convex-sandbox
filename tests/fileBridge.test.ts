import { convexTest } from "convex-test";
import { defineSchema } from "convex/server";
import { expect, test } from "vitest";
import { register } from "@fantastic.dev/convex-sandbox/testing";
import { internal } from "../example/convex/_generated/api.js";

test("internal host file proof uses component registry without persisting file data or URLs", async () => {
  const t = convexTest(defineSchema({}), {
    "./_generated/server.js": () =>
      import("../example/convex/_generated/server.js"),
    "./proof.ts": () => import("../example/convex/proof.js"),
  });
  const c = register(t);
  expect(await t.action(internal.proof.files, {})).toEqual({
    text: true,
    binary: true,
    listed: true,
    deleted: true,
    transferBounded: true,
    denied: true,
  });
  const record = await t.query(c.registry.get, {
    sandbox: { scope: "internal-fixture", key: "files-proof" },
  });
  expect(JSON.stringify(record)).not.toContain("synthetic-file-content");
  expect(JSON.stringify(record)).not.toContain("signed");
});
