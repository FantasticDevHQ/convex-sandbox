import { test, expect } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "../../example/convex/schema";
import * as proof from "../../example/convex/appIsolationProof";
const seed = makeFunctionReference<"mutation">("appIsolationProof:seed"),
  get = makeFunctionReference<"query">("appIsolationProof:get");
function fixture() {
  return convexTest(schema, {
    "./_generated/server.js": () =>
      import("../../example/convex/_generated/server.js"),
    "./appIsolationProof.ts": async () => proof,
  });
}
test("app isolation fixture writes real app ledger tables without replacing retained work", async () => {
  const a = fixture(),
    b = fixture();
  expect(await a.query(get, {})).toBeNull();
  const run = await a.mutation(seed, { runId: "qualification-alpha" });
  expect(run).toEqual({
    runId: "qualification-alpha",
    intentKeys: ["qualification-create"],
    unknown: 1,
  });
  expect(await b.query(get, {})).toBeNull();
  expect(await a.mutation(seed, { runId: "qualification-alpha" })).toEqual(run);
  await expect(
    a.mutation(seed, { runId: "qualification-beta" }),
  ).rejects.toThrow("Never replace");
  expect(await a.query(get, {})).toEqual(run);
  expect(
    await a.run(async (ctx) => ({
      approvals: (await ctx.db.query("liveApprovals").collect()).length,
      reservations: (await ctx.db.query("liveReservations").collect()).length,
    })),
  ).toEqual({ approvals: 1, reservations: 1 });
});
test("app isolation fixture rejects non-qualification run IDs", async () => {
  const t = fixture();
  await expect(
    t.mutation(seed, { runId: "unrelated-user-run" }),
  ).rejects.toThrow();
  expect(await t.query(get, {})).toBeNull();
});
