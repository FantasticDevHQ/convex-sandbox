import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { register } from "@fantastic.dev/convex-sandbox/testing";
import { api } from "../../example/convex/_generated/api.js";
import schema from "../../example/convex/schema.js";

test.each([undefined, "synthetic-ambient-boat-key"])(
  "playground remains explicitly simulated regardless of ambient Boat configuration (%s)",
  async (key) => {
    vi.stubEnv("BOAT_API_KEY", key);
    vi.stubEnv("CONVEX_SITE_URL", "http://127.0.0.1:3211");
    const network = vi.fn(() => {
      throw new Error("Live provider access forbidden in the playground test");
    });
    vi.stubGlobal("fetch", network);
    try {
      const t = convexTest(schema, {
        "./_generated/server.js": () =>
          import("../../example/convex/_generated/server.js"),
        "./demo.ts": () => import("../../example/convex/demo.js"),
        "./demo/store.ts": () => import("../../example/convex/demo/store.js"),
      });
      register(t);
      const info = await t.query(api.demo.info, {});
      expect(info).toMatchObject({ mode: "simulation", localFixture: true });
      expect(
        info.profiles.every((profile) =>
          profile.provider.startsWith("simulated-"),
        ),
      ).toBe(true);
      await t.action(api.demo.seed, {});
      const rows = await t.query(api.demo.list, {});
      expect(
        rows.page.every((row) =>
          row.reference.provider.startsWith("simulated-"),
        ),
      ).toBe(true);
      expect(JSON.stringify(rows)).not.toContain("synthetic-ambient-boat-key");
      expect(network).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  },
);
