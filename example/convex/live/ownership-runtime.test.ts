import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { register } from "@fantastic.dev/convex-sandbox/testing";
import { test, expect, vi, afterEach } from "vitest";
import schema from "../schema";
import { worktreeOwnershipFixture } from "../../../tests/boat/worktree-fixture";
import { readOwnership } from "../../../scripts/worktree/boat-ownership-store.mjs";
const issuer = "https://ownership-qualification.invalid";
const subject = "synthetic-operator";
afterEach(() => vi.unstubAllEnvs());
test.each([false, true])(
  "production ownership action path, unknown=%s",
  async (unknown) => {
    const ownership = await worktreeOwnershipFixture();
    try {
      vi.stubEnv("EXAMPLE_WORKTREE_OWNERSHIP", JSON.stringify(ownership.owner));
      vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:19999");
      vi.stubEnv(
        "EXAMPLE_OPERATOR_GRANTS",
        JSON.stringify([{ issuer, subject, scope: "ownership-qualification" }]),
      );
      vi.stubEnv(
        "EXAMPLE_LIVE_RUN_PLAN",
        JSON.stringify({
          runId: "ownership-qualification-alpha",
          scope: "example-boat:ownership-qualification",
          accountId: "synthetic-qualification-account",
          wallet: "personal",
          walletTeamId: null,
          size: "small",
          expiresAt: Date.now() + 600000,
          maxMachines: 2,
          maxStarts: 2,
          maxConcurrent: 2,
          durationMinutes: 10,
          estimateUsd: 0.1,
          allowanceUsd: 1,
        }),
      );
      const t = convexTest(schema, {
        "./_generated/server.js": () => import("../_generated/server.js"),
        "./ownershipRuntimeFixture.ts": () =>
          import("../../fixtures/ownershipRuntime"),
        "./live/ownership.ts": () => import("./ownership"),
        "./live/ownershipData.ts": () => import("./ownershipData"),
        "./live/allowance.ts": () => import("./allowance"),
      });
      register(t);
      const operator = t.withIdentity({ issuer, subject });
      const dispatch = makeFunctionReference<"action">(
        "ownershipRuntimeFixture:dispatch",
      );
      const recover = makeFunctionReference<"action">("live/ownership:retain");
      const args = { unknown };
      expect(await operator.action(dispatch, args)).toMatchObject({
        calls: 1,
        status: unknown ? "unknown" : "succeeded",
      });
      await operator.action(recover, {
        key: unknown ? "ownership-unknown" : "ownership-known",
        kind: "create",
      });
      expect(await operator.action(dispatch, args)).toMatchObject({
        calls: 0,
        status: unknown ? "unknown" : "succeeded",
      });
      const record = (
        await readOwnership(ownership.owner.directory, ownership.owner.id)
      ).intents[0];
      expect(record).toMatchObject({
        nativeId: unknown ? null : "synthetic-ownership-known",
        outcome: unknown ? "unknown" : "identified",
      });
      await expect(
        t.action(recover, { key: record.key, kind: "create" }),
      ).rejects.toThrow();
      vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:19998");
      await expect(
        operator.action(recover, { key: record.key, kind: "create" }),
      ).rejects.toThrow("local backend");
    } finally {
      await ownership.cleanup();
    }
  },
);
