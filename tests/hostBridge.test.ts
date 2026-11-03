import { convexTest } from "convex-test";
import { defineSchema } from "convex/server";
import { expect, test } from "vitest";
import { register } from "@fantastic.dev/convex-sandbox/testing";
import { internal } from "../example/convex/_generated/api.js";

test("internal host proof denies actual cross-scope SDK calls and retains no command text", async () => {
  const t = convexTest(defineSchema({}), {
    "./_generated/server.js": () =>
      import("../example/convex/_generated/server.js"),
    "./proof.ts": () => import("../example/convex/proof.js"),
  });
  const c = register(t);
  expect(await t.action(internal.proof.hostSecurity, {})).toEqual({
    deniedAcrossScopes: true,
    deniedListInjection: true,
    noUnauthorizedSDKCalls: true,
    outputWithheld: true,
    safeError: true,
    secretHandleBlocked: true,
  });
  const logs = await t.query(c.execution.logs, {
    sandbox: { scope: "host-fixture-a", key: "owned" },
    operationId: "command",
    cursor: null,
    limit: 10,
  });
  expect(logs.entries).toHaveLength(0);
});
