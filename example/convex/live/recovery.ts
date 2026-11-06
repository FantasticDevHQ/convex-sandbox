import { v, type Infer } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query, action } from "../_generated/server";
import { api, components } from "../_generated/api";
import {
  operationPageValidator,
  operationRecordValidator,
  registryRecordValidator,
  provisionRecordValidator,
  createLifecycleStore,
  createExecutionStore,
  createImageStore,
  type OperationRecord,
} from "@fantastic.dev/convex-sandbox";
import { requireOperator } from "./operator";
import { ownedBoatClient } from "./boatHost";
import { admissionKind, reservationStatus, refuse } from "./allowanceModel";
const handle = { key: v.string(), operationId: v.string() };
const contextValidator = v.object({
  row: v.union(registryRecordValidator, v.null()),
  provision: v.union(provisionRecordValidator, v.null()),
  admissions: v.array(
    v.object({
      operationId: v.string(),
      kind: admissionKind,
      status: reservationStatus,
      createdAt: v.number(),
    }),
  ),
  admissionsTruncated: v.boolean(),
  forkSource: v.union(v.string(), v.null()),
});
export type RecoveryContext = Infer<typeof contextValidator>;
/** Cached reads only. Keep old generations visible as history, never as current work. */
export const list = query({
  args: { key: v.string(), paginationOpts: paginationOptsValidator },
  returns: operationPageValidator,
  handler: async (ctx, { key, paginationOpts }) => {
    const operator = await requireOperator(ctx);
    if (
      !Number.isSafeInteger(paginationOpts.numItems) ||
      paginationOpts.numItems < 1 ||
      paginationOpts.numItems > 50
    )
      refuse("Request 1–50 retained records per page.");
    const page = await ctx.runQuery(components.sandbox.operations.list, {
      sandbox: { scope: operator.scope, key },
      paginationOpts,
    });
    return {
      ...page,
      page: page.page.filter((op) => op.reference.provider === "boat"),
    };
  },
});
export const get = query({
  args: handle,
  returns: v.union(operationRecordValidator, v.null()),
  handler: async (
    ctx,
    { key, operationId },
  ): Promise<OperationRecord | null> => {
    const operator = await requireOperator(ctx);
    const op = await ctx.runQuery(components.sandbox.operations.get, {
      sandbox: { scope: operator.scope, key },
      operationId,
    });
    return op?.reference.provider === "boat" ? op : null;
  },
});
export const context = query({
  args: { key: v.string() },
  returns: contextValidator,
  handler: async (ctx, { key }): Promise<RecoveryContext> => {
    const operator = await requireOperator(ctx),
      sandbox = { scope: operator.scope, key };
    const row = await ctx.runQuery(components.sandbox.registry.get, {
      sandbox,
    });
    const provision = await ctx.runQuery(
      components.sandbox.lifecycle.getProvision,
      { sandbox },
    );
    const admissions = [];
    let admissionsTruncated = false;
    for (const kind of ["create", "fork", "start"] as const) {
      const records = await ctx.db
        .query("liveReservations")
        .withIndex("by_scope_and_machineKey_and_kind", (q) =>
          q.eq("scope", operator.scope).eq("machineKey", key).eq("kind", kind),
        )
        .order("desc")
        .take(21);
      admissionsTruncated ||= records.length > 20;
      admissions.push(
        ...records
          .slice(0, 20)
          .map((r) => ({
            operationId: r.intentKey,
            kind: r.kind,
            status: r.status,
            createdAt: r.createdAt,
          })),
      );
    }
    const fork = await ctx.db
      .query("liveForks")
      .withIndex("by_scope_and_childKey", (q) =>
        q.eq("scope", operator.scope).eq("childKey", key),
      )
      .unique();
    return {
      row: row?.reference.provider === "boat" ? row : null,
      provision: provision?.provider === "boat" ? provision : null,
      admissions,
      admissionsTruncated,
      forkSource: fork?.sourceKey ?? null,
    };
  },
});
export const inspect = action({
  args: { ...handle, generation: v.number(), providerId: v.string() },
  returns: v.union(operationRecordValidator, v.null()),
  handler: async (ctx, input): Promise<OperationRecord | null> => {
    const operator = await requireOperator(ctx),
      sandbox = { scope: operator.scope, key: input.key };
    const op = await ctx.runQuery(api.live.recovery.get, {
      key: input.key,
      operationId: input.operationId,
    });
    const row = await ctx.runQuery(components.sandbox.registry.get, {
      sandbox,
    });
    if (
      !op ||
      !row ||
      row.tombstone ||
      row.generation !== input.generation ||
      op.generation !== input.generation ||
      op.reference.providerId !== input.providerId ||
      row.reference.providerId !== input.providerId
    )
      refuse("The original binding changed. Retain this operation as history.");
    if (["succeeded", "failed", "cancelled"].includes(op.status)) return op;
    const lifecycle = ["start", "resumeMemory", "stop", "delete"].includes(
      op.kind,
    );
    // No native handle means no safe Boat lookup. Never replay an intent to discover its result.
    if (
      !lifecycle &&
      op.kind !== "execute" &&
      !(op.kind === "fork" && op.nativeImage?.providerOperationId)
    )
      return op;
    if (op.kind === "execute" && !op.executionId) return op;
    const c = await ownedBoatClient(
      ctx,
      input.key,
      lifecycle
        ? "describe"
        : op.kind === "execute"
          ? "executionStatus"
          : "imageStatus",
    );
    if (
      c.generation !== input.generation ||
      c.reference.providerId !== input.providerId
    )
      refuse("The original binding changed.");
    if (lifecycle)
      await c.providers
        .lifecycle(createLifecycleStore(ctx, components.sandbox))
        .reconcile({
          sandbox,
          operationId: op.operationId,
          policy: { maxAttempts: 1, maxElapsedMs: 5000, callTimeoutMs: 5000 },
        });
    else if (op.kind === "execute")
      await c.providers
        .execution(createExecutionStore(ctx, components.sandbox))
        .status({ sandbox, operationId: op.operationId }, 5000);
    else
      await c.providers
        .images(createImageStore(ctx, components.sandbox))
        .status({ sandbox, operationId: op.operationId });
    return ctx.runQuery(api.live.recovery.get, {
      key: input.key,
      operationId: input.operationId,
    });
  },
});
