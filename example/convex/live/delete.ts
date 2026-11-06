import { action, query } from "../_generated/server";
import { api, components } from "../_generated/api";
import { v } from "convex/values";
import {
  registryRecordValidator,
  operationRecordValidator,
  createLifecycleStore,
  type RegistryRecord,
  type OperationRecord,
} from "@fantastic.dev/convex-sandbox";
import { requireOperator } from "./operator";
import { refuse } from "./allowanceModel";
import { ownedBoatClient } from "./boatHost";
const phaseValidator = v.union(
  v.literal("not_requested"),
  v.literal("pending"),
  v.literal("unresolved"),
  v.literal("confirmed"),
);
const viewValidator = v.object({
  row: v.union(registryRecordValidator, v.null()),
  operation: v.union(operationRecordValidator, v.null()),
  reviewToken: v.union(v.string(), v.null()),
  phase: phaseValidator,
});
export type DeleteView = {
  row: RegistryRecord | null;
  operation: OperationRecord | null;
  reviewToken: string | null;
  phase: "not_requested" | "pending" | "unresolved" | "confirmed";
};
function token(row: RegistryRecord) {
  return JSON.stringify([
    "delete",
    row.scope,
    row.key,
    row.generation,
    row.reference.provider,
    row.reference.providerId,
  ]);
}
export const status = query({
  args: { key: v.string() },
  returns: viewValidator,
  handler: async (ctx, { key }): Promise<DeleteView> => {
    const operator = await requireOperator(ctx);
    const sandbox = { scope: operator.scope, key };
    const row = await ctx.runQuery(components.sandbox.registry.get, {
      sandbox,
    });
    if (row?.reference.provider !== "boat")
      return {
        row: null,
        operation: null,
        reviewToken: null,
        phase: "not_requested",
      };
    const operation = await ctx.runQuery(components.sandbox.operations.get, {
      sandbox,
      operationId: `delete-${row.generation}`,
    });
    const matching =
      operation?.kind === "delete" &&
      operation.generation === row.generation &&
      operation.reference.provider === "boat" &&
      operation.reference.providerId === row.reference.providerId;
    const confirmed =
      matching &&
      operation.status === "succeeded" &&
      Boolean(operation.nativeLifecycle) &&
      row.tombstone &&
      row.observedState === "deleted";
    const phase = confirmed
      ? "confirmed"
      : operation || row.tombstone
        ? matching &&
          operation.nativeLifecycle &&
          !operation.errorCode &&
          !["failed", "cancelled"].includes(operation.status) &&
          !row.tombstone
          ? "pending"
          : "unresolved"
        : "not_requested";
    return { row, operation, reviewToken: token(row), phase };
  },
});
export const request = action({
  args: { key: v.string(), confirmation: v.string(), reviewToken: v.string() },
  returns: viewValidator,
  handler: async (ctx, args): Promise<DeleteView> => {
    await requireOperator(ctx);
    const view = await ctx.runQuery(api.live.delete.status, { key: args.key });
    if (
      !view.row ||
      args.confirmation !== args.key ||
      args.reviewToken !== view.reviewToken
    )
      refuse("Confirm the exact current owned machine before deletion.");
    if (view.operation || view.row.tombstone) return view;
    if (view.row.activeOperationId)
      refuse("Reconcile the unfinished owned operation before deletion.");
    const c = await ownedBoatClient(ctx, args.key, "delete");
    if (
      c.generation !== view.row.generation ||
      token(view.row) !==
        JSON.stringify([
          "delete",
          c.sandbox.scope,
          c.sandbox.key,
          view.row.generation,
          c.reference.provider,
          c.reference.providerId,
        ])
    )
      refuse("The selected binding changed. Review deletion again.");
    const current = await ctx.runQuery(api.live.delete.status, {
      key: args.key,
    });
    if (current.reviewToken !== args.reviewToken)
      refuse("The selected binding changed. Review deletion again.");
    await c.providers
      .lifecycle(createLifecycleStore(ctx, components.sandbox))
      .run({
        sandbox: c.sandbox,
        operationId: `delete-${view.row.generation}`,
        action: "delete",
      });
    return ctx.runQuery(api.live.delete.status, { key: args.key });
  },
});
export const inspect = action({
  args: { key: v.string() },
  returns: viewValidator,
  handler: async (ctx, { key }): Promise<DeleteView> => {
    await requireOperator(ctx);
    const view = await ctx.runQuery(api.live.delete.status, { key });
    if (!view.operation || view.phase === "confirmed" || view.row?.tombstone)
      return view;
    if (
      view.operation.kind !== "delete" ||
      view.operation.reference.providerId !== view.row?.reference.providerId ||
      view.operation.generation !== view.row.generation
    )
      refuse("The retained deletion no longer matches the current binding.");
    const c = await ownedBoatClient(ctx, key, "describe");
    await c.providers
      .lifecycle(createLifecycleStore(ctx, components.sandbox))
      .reconcile({
        sandbox: c.sandbox,
        operationId: view.operation.operationId,
        policy: { maxAttempts: 1, maxElapsedMs: 5000, callTimeoutMs: 5000 },
      });
    return ctx.runQuery(api.live.delete.status, { key });
  },
});
