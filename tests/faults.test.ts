import { expect, test } from "vitest";
import { instrumentAdapter } from "@fantastic.dev/convex-sandbox/testing";

test("fault instrumentation supports prototype methods and preserves private receiver state", async () => {
  class Adapter {
    #calls = 0;
    async describe(providerId: string) {
      this.#calls++;
      return {
        providerId,
        state: "running" as const,
        resources: { cpuCount: this.#calls },
      };
    }
  }
  const { provider, faults } = instrumentAdapter({
    name: "external",
    adapter: new Adapter(),
  });
  expect(await provider.adapter.describe("fixture-vm")).toMatchObject({
    resources: { cpuCount: 1 },
  });
  faults.failNext("describe", "after");
  await expect(provider.adapter.describe("fixture-vm")).rejects.toMatchObject({
    data: { outcome: "unknown" },
  });
  expect(await provider.adapter.describe("fixture-vm")).toMatchObject({
    resources: { cpuCount: 3 },
  });
  expect(faults.counts().describe).toEqual({ attempts: 3, dispatched: 3 });
});
