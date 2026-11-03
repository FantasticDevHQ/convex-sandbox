import { convexTest } from "convex-test";
import { defineSchema } from "convex/server";
import { expect, test } from "vitest";
import { register } from "@fantastic.dev/convex-sandbox/testing";

const hostModules = {
  "../example/convex/_generated/server.js": () =>
    import("../example/convex/_generated/server.js"),
  "../example/convex/proof.ts": () => import("../example/convex/proof.js"),
};

test("serializable observations can be written and queried across the component boundary", async () => {
  const t = convexTest(defineSchema({}), hostModules);
  const component = register(t);
  const observation = {
    scope: "fixture-a",
    key: "machine",
    provider: "simulated",
    providerId: "fixture-1",
    state: "running" as const,
  };
  await t.mutation(component.observations.record, observation);
  expect(
    await t.query(component.observations.get, {
      scope: "fixture-a",
      key: "machine",
    }),
  ).toEqual(observation);
  expect(
    await t.query(component.observations.get, {
      scope: "fixture-b",
      key: "machine",
    }),
  ).toBeNull();
});

test("an internal host action invokes its adapter and persists into the mounted component", async () => {
  const { makeFunctionReference } = await import("convex/server");
  const t = convexTest(defineSchema({}), hostModules);
  const component = register(t);
  await t.action(makeFunctionReference<"action">("proof:observe"), {});
  expect(
    await t.query(component.observations.get, {
      scope: "internal-fixture",
      key: "proof",
    }),
  ).toEqual({
    scope: "internal-fixture",
    key: "proof",
    provider: "simulated",
    providerId: "fixture-1",
    state: "running",
  });
});

test("an internal host action orchestrates create, stop and delete through the component bridge", async () => {
  const { makeFunctionReference } = await import("convex/server");
  const t = convexTest(defineSchema({}), hostModules);
  register(t);
  expect(
    await t.action(makeFunctionReference<"action">("proof:lifecycle"), {}),
  ).toEqual({ created: true, stopped: true, deleted: true });
});
