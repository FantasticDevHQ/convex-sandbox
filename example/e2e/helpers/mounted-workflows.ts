import { SyntheticBoatHTTP } from "./offline-network";
export { SyntheticBoatHTTP, trapBrowserNetwork } from "./offline-network";
import type { RecoveryContext } from "../../convex/live/recovery";
import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { register } from "@fantastic.dev/convex-sandbox/testing";
import schema from "../../convex/schema";
import { encode, decode } from "./workflow-wire";
import type { CreationView } from "../../convex/live/create";
import type { LifecycleView } from "../../convex/live/lifecycle";
import type { ForkView } from "../../convex/live/fork";
import type { CleanupView } from "../../convex/live/cleanupModel";
import type { RunReview } from "../../src/allowance-panel";
import type {
  ExecutionRecord,
  CachedLogPage,
  OperationRecord,
} from "@fantastic.dev/convex-sandbox";
export type WorkflowSnapshot = {
  review: RunReview;
  creation: CreationView;
  lifecycle: LifecycleView;
  fork: ForkView;
  cleanup: CleanupView | null;
  record: ExecutionRecord | null;
  cache: CachedLogPage | null;
  operationId: string | null;
  recovery: RecoveryContext;
  operations: OperationRecord[];
};
export async function createMountedBackend() {
  assert.equal(
    process.env.CSB_OFFLINE_SECRET_ENV,
    "empty",
    "Run through the offline Playwright configuration",
  );
  for (const name of [
    "BOAT_API_KEY",
    "EXAMPLE_OPERATOR_GRANTS",
    "EXAMPLE_LIVE_RUN_PLAN",
    "CLERK_SECRET_KEY",
    "CONVEX_DEPLOY_KEY",
  ])
    assert.equal(
      process.env[name],
      undefined,
      `${name} must be absent before synthetic configuration`,
    );
  const names = [
    "BOAT_API_KEY",
    "BOAT_ORG",
    "EXAMPLE_OPERATOR_GRANTS",
    "EXAMPLE_LIVE_RUN_PLAN",
  ];
  const issuer = "https://offline.clerk.accounts.dev";
  process.env.BOAT_API_KEY = "<OFFLINE_SYNTHETIC_KEY>";
  process.env.BOAT_ORG = "personal";
  process.env.EXAMPLE_OPERATOR_GRANTS = JSON.stringify([
    { issuer, subject: "offline-operator", scope: "offline" },
  ]);
  process.env.EXAMPLE_LIVE_RUN_PLAN = JSON.stringify({
    runId: "offline-run",
    scope: "example-boat:offline",
    accountId: "offline-account",
    wallet: "personal",
    walletTeamId: null,
    size: "small",
    expiresAt: Date.now() + 3600000,
    maxMachines: 2,
    maxStarts: 4,
    maxConcurrent: 2,
    durationMinutes: 60,
    estimateUsd: 0.1,
    allowanceUsd: 1,
  });
  const http = new SyntheticBoatHTTP(),
    ambientFetch = globalThis.fetch;
  globalThis.fetch = http.fetch.bind(http) as typeof fetch;
  const t = convexTest(schema, {
    "./_generated/server.js": () => import("../../convex/_generated/server.js"),
    "./live/allowance.ts": () => import("../../convex/live/allowance"),
    "./live/create.ts": () => import("../../convex/live/create"),
    "./live/machines.ts": () => import("../../convex/live/machines"),
    "./live/lifecycle.ts": () => import("../../convex/live/lifecycle"),
    "./live/commands.ts": () => import("../../convex/live/commands"),
    "./live/logs.ts": () => import("../../convex/live/logs"),
    "./live/files.ts": () => import("../../convex/live/files"),
    "./live/fork.ts": () => import("../../convex/live/fork"),
    "./live/catalog.ts": () => import("../../convex/live/catalog"),
    "./live/recovery.ts": () => import("../../convex/live/recovery"),
    "./live/cleanup.ts": () => import("../../convex/live/cleanup"),
    "./live/delete.ts": () => import("../../convex/live/delete"),
  });
  register(t);
  const operator = t.withIdentity({ issuer, subject: "offline-operator" });
  const query = async <T>(
    endpoint: string,
    args: Record<string, unknown>,
  ): Promise<T> =>
    operator.query(
      makeFunctionReference<"query">(`live/${endpoint}`),
      args,
    ) as Promise<T>;
  const action = async (endpoint: string, args: Record<string, unknown>) =>
    operator.action(makeFunctionReference<"action">(`live/${endpoint}`), args);
  let operationId: string | null = null;
  const key = "research-one",
    sourceKey = key,
    childKey = "research-child";
  async function snapshot(): Promise<WorkflowSnapshot> {
    const review = await query<RunReview>("allowance:proposal", {});
    return {
      review,
      creation: await query("create:status", { key }),
      lifecycle: await query("lifecycle:status", { key }),
      fork: await query("fork:status", { sourceKey, childKey }),
      cleanup: review.approval
        ? await query("cleanup:status", { runId: "offline-run" })
        : null,
      record: operationId
        ? await query("commands:get", { key, operationId })
        : null,
      cache: operationId
        ? await query("logs:cached", { key, operationId })
        : null,
      operationId,
      recovery: await query("recovery:context", { key }),
      operations: (
        await query<{ page: OperationRecord[] }>("recovery:list", {
          key,
          paginationOpts: { cursor: null, numItems: 50 },
        })
      ).page,
    };
  }
  const allowed = new Set([
    "allowance:approve",
    "create:create",
    "machines:refresh",
    "commands:start",
    "commands:inspect",
    "logs:sync",
    "files:list",
    "files:read",
    "files:write",
    "files:remove",
    "lifecycle:prepareFixture",
    "lifecycle:run",
    "lifecycle:inspect",
    "fork:start",
    "fork:inspect",
    "fork:verify",
    "catalog:load",
    "recovery:inspect",
    "cleanup:requestNext",
    "cleanup:inspectNext",
  ]);
  async function rpc(endpoint: string, wire: unknown) {
    if (endpoint === "snapshot") return encode({ snapshot: await snapshot() });
    if (!allowed.has(endpoint)) throw Error("Unknown offline endpoint");
    const args = decode(wire) as Record<string, unknown>;
    if (endpoint === "commands:start") operationId = String(args.operationId);
    const result = await action(endpoint, args);
    http.assertClean();
    return encode({ result, snapshot: await snapshot() });
  }
  return {
    http,
    rpc,
    denied: async () => {
      await t.query(makeFunctionReference<"query">("live/machines:list"), {
        paginationOpts: { cursor: null, numItems: 20 },
      });
    },
    foreign: async () => {
      await t
        .withIdentity({ issuer, subject: "denied" })
        .query(makeFunctionReference<"query">("live/machines:list"), {
          paginationOpts: { cursor: null, numItems: 20 },
        });
    },
    prepare: async () => {
      const review = await query<RunReview>("allowance:proposal", {});
      await action("allowance:approve", {
        reviewToken: review.reviewToken,
        acknowledgeRisk: true,
      });
      await action("create:create", { key });
    },
    close: () => {
      globalThis.fetch = ambientFetch;
      for (const name of names) delete process.env[name];
      http.assertClean();
    },
  };
}
