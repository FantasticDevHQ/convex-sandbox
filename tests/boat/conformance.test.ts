import { convexTest } from "convex-test";
import { defineSchema } from "convex/server";
import { expect, test, vi } from "vitest";
import {
  adapterConformance,
  createTestStores,
  register,
} from "@fantastic.dev/convex-sandbox/testing";
import { boatConformanceFixture } from "../../example/fixtures/boatConformance.js";

const factory = () => {
  const t = convexTest(defineSchema({}), {
    "./_generated/server.js": () =>
      import("../../example/convex/_generated/server.js"),
  });
  return boatConformanceFixture(
    createTestStores(
      t,
      register(t),
      ({ path }) =>
        path === "/tmp/boat-conformance" ||
        path.startsWith("/tmp/boat-conformance/"),
    ),
    { scope: "offline-boat-conformance", key: "machine" },
  );
};
for (const item of adapterConformance(factory))
  test(`Boat HTTP: ${item.name}`, async () => {
    const network = vi.fn(() => {
      throw new Error("Live network forbidden in Boat conformance");
    });
    vi.stubGlobal("fetch", network);
    try {
      const result = await item.run();
      if (item.name === "cancellation acknowledgement")
        expect(result).toMatchObject({
          status: "skipped",
          reason: "requires execute, cancelExecution",
        });
      else expect(result.status).toBe("passed");
      expect(network).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
