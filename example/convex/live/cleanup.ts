import { v } from "convex/values";
import { action, query, mutation, type QueryCtx } from "../_generated/server";
import { api, components } from "../_generated/api";
import { requireOperator } from "./operator";
import { refuse } from "./allowanceModel";
import {
  cleanupViewValidator,
  type CleanupView,
  type CleanupTarget,
  CLEANUP_RETENTION_MS,
} from "./cleanupModel";
const args = { runId: v.string() };
const confirmedArgs = {
  ...args,
  reviewToken: v.string(),
  confirmation: v.string(),
};
/** Cached run-local proofs, never provider inventory. All reads are bounded. */
async function read(
  ctx: Pick<QueryCtx, "auth" | "db" | "runQuery">,
  runId: string,
): Promise<CleanupView> {
  const operator = await requireOperator(ctx),
    scope = operator.scope;
  const approval = await ctx.db
    .query("liveApprovals")
    .withIndex("by_scope", (q) => q.eq("scope", scope))
    .unique();
  if (!approval || approval.plan.runId !== runId)
    refuse("Choose the exact retained run in this operator scope.");
  const rows = await ctx.db
    .query("liveReservations")
    .withIndex("by_scope_and_runId_and_intentKey", (q) =>
      q.eq("scope", scope).eq("runId", runId),
    )
    .take(21);
  const truncated = rows.length > 20,
    reservations = rows.slice(0, 20),
    targets: CleanupTarget[] = [],
    unresolvedIntents: string[] = [];
  let latestTerminal = Math.max(
    approval.plan.expiresAt,
    approval.approvedAt + approval.plan.durationMinutes * 60000,
  );
  // Fork targets precede parents. At most two machines can be admitted by the reviewed plan.
  for (const reservation of reservations
    .filter((r) => r.kind !== "start")
    .sort((a, b) => Number(b.kind === "fork") - Number(a.kind === "fork"))) {
    const key = reservation.machineKey,
      sandbox = { scope, key };
    const target: CleanupTarget = {
      key,
      kind: reservation.kind as "create" | "fork",
      operationId: reservation.intentKey,
      providerId: null,
      generation: null,
      phase: "unresolved",
      reason: "No confirmed original binding. Keep the intent for recovery.",
      deleteToken: null,
    };
    if (reservation.approvalId !== approval._id) {
      unresolvedIntents.push(reservation.intentKey);
      targets.push(target);
      continue;
    }
    if (reservation.kind === "create") {
      const provision = await ctx.runQuery(
        components.sandbox.lifecycle.getProvision,
        { sandbox },
      );
      if (
        provision?.operationId === reservation.intentKey &&
        provision.provider === "boat" &&
        provision.createdAt >= reservation.createdAt
      ) {
        if (provision.status === "failed") {
          target.phase = "not_created";
          target.reason =
            "Component records a confirmed creation failure before side effects.";
          latestTerminal = Math.max(latestTerminal, provision.updatedAt);
        } else if (
          provision.status === "succeeded" &&
          provision.reference?.provider === "boat"
        ) {
          target.providerId = provision.reference.providerId;
          target.generation = 1;
        }
      }
    } else {
      const fork = await ctx.db
        .query("liveForks")
        .withIndex("by_scope_and_childKey", (q) =>
          q.eq("scope", scope).eq("childKey", key),
        )
        .unique();
      if (
        fork?.reservationId === reservation._id &&
        fork.operationId === reservation.intentKey &&
        fork.childId &&
        fork.childGeneration
      ) {
        target.providerId = fork.childId;
        target.generation = fork.childGeneration;
      }
    }
    if (target.providerId && target.generation) {
      const row = await ctx.runQuery(components.sandbox.registry.get, {
        sandbox,
      });
      const op = await ctx.runQuery(components.sandbox.operations.get, {
        sandbox,
        operationId: `delete-${target.generation}`,
      });
      const matching =
        op?.kind === "delete" &&
        op.generation === target.generation &&
        op.reference.provider === "boat" &&
        op.reference.providerId === target.providerId;
      if (matching && op.status === "succeeded" && op.nativeLifecycle) {
        target.phase = "confirmed";
        target.reason =
          "Matching native deletion job completed. Recovery records remain retained.";
        latestTerminal = Math.max(latestTerminal, op.updatedAt);
      } else if (
        row?.reference.provider === "boat" &&
        row.reference.providerId === target.providerId &&
        row.generation === target.generation &&
        !row.tombstone
      ) {
        if (op) {
          target.phase =
            matching &&
            op.nativeLifecycle &&
            !op.errorCode &&
            !["failed", "cancelled"].includes(op.status)
              ? "pending"
              : "unresolved";
          target.reason =
            target.phase === "pending"
              ? "Deletion is accepted, but its matching native job has not completed."
              : "The original deletion is unresolved. Inspect it without replay.";
        } else if (!row.activeOperationId) {
          target.phase = "ready";
          target.reason = "Exact original binding recorded in this run.";
          target.deleteToken = JSON.stringify([
            "delete",
            scope,
            key,
            target.generation,
            "boat",
            target.providerId,
          ]);
        } else
          target.reason =
            "Reconcile the active operation before requesting deletion.";
      } else
        target.reason =
          "Original binding is missing or replaced. Cleanup cannot target the replacement.";
    }
    targets.push(target);
  }
  // An admission without its original terminal start operation is still an unresolved intent.
  for (const r of reservations.filter((r) => r.kind === "start")) {
    const op = await ctx.runQuery(components.sandbox.operations.get, {
      sandbox: { scope, key: r.machineKey },
      operationId: r.intentKey,
    });
    if (
      r.approvalId !== approval._id ||
      !op ||
      !["start", "resumeMemory"].includes(op.kind) ||
      op.reference.provider !== "boat" ||
      !["succeeded", "failed", "cancelled"].includes(op.status)
    )
      unresolvedIntents.push(r.intentKey);
    else latestTerminal = Math.max(latestTerminal, op.updatedAt);
  }
  // An unbound child could still exist. Never delete its source to hide that uncertainty.
  const unresolvedChild = targets.some(
    (t) => t.kind === "fork" && !["confirmed", "not_created"].includes(t.phase),
  );
  if (unresolvedChild)
    for (const target of targets.filter(
      (t) => t.kind === "create" && t.phase === "ready",
    )) {
      target.phase = "unresolved";
      target.reason =
        "Resolve and confirm cleanup of the recorded child before its parent.";
      target.deleteToken = null;
    }
  const complete =
    !truncated &&
    !unresolvedIntents.length &&
    targets.every((t) => ["confirmed", "not_created"].includes(t.phase));
  const resetAfter = complete ? latestTerminal + CLEANUP_RETENTION_MS : null;
  const archive = await ctx.db
    .query("liveCleanupArchives")
    .withIndex("by_scope_and_runId", (q) =>
      q.eq("scope", scope).eq("runId", runId),
    )
    .unique();
  const reviewToken = JSON.stringify([
    "cleanup",
    scope,
    runId,
    reservations.map((r) => [r._id, r.intentKey, r.status]),
    targets,
    unresolvedIntents,
    truncated,
  ]);
  return {
    runId,
    targets,
    unresolvedIntents,
    truncated,
    complete,
    reviewToken,
    canReset:
      complete &&
      resetAfter !== null &&
      Date.now() >= resetAfter &&
      archive === null,
    resetAfter,
    archivedAt: archive?.archivedAt ?? null,
  };
}
export const status = query({
  args: { ...args, revision: v.optional(v.number()) },
  returns: cleanupViewValidator,
  handler: (ctx, { runId }) => read(ctx, runId),
});
export const requestNext = action({
  args: confirmedArgs,
  returns: cleanupViewValidator,
  handler: async (ctx, input): Promise<CleanupView> => {
    await requireOperator(ctx);
    const view = await ctx.runQuery(api.live.cleanup.status, {
      runId: input.runId,
    });
    if (
      input.confirmation !== input.runId ||
      input.reviewToken !== view.reviewToken
    )
      refuse("Confirm the exact current run cleanup review.");
    if (view.truncated || view.archivedAt !== null) return view;
    const target = view.targets.find(
      (t) => !["confirmed", "not_created"].includes(t.phase),
    );
    if (target?.phase !== "ready" || !target.deleteToken) return view;
    // Existing public host workflow independently checks this exact binding again before dispatch.
    await ctx.runAction(api.live.delete.request, {
      key: target.key,
      confirmation: target.key,
      reviewToken: target.deleteToken,
    });
    return ctx.runQuery(api.live.cleanup.status, { runId: input.runId });
  },
});
export const inspectNext = action({
  args,
  returns: cleanupViewValidator,
  handler: async (ctx, input): Promise<CleanupView> => {
    await requireOperator(ctx);
    const view = await ctx.runQuery(api.live.cleanup.status, input);
    const target = view.targets.find(
      (t) =>
        t.providerId &&
        t.generation &&
        ["pending", "unresolved"].includes(t.phase),
    );
    if (target && !view.truncated) {
      const original = await ctx.runQuery(components.sandbox.operations.get, {
        sandbox: { scope: (await requireOperator(ctx)).scope, key: target.key },
        operationId: `delete-${target.generation}`,
      });
      if (
        original?.kind === "delete" &&
        original.generation === target.generation &&
        original.reference.providerId === target.providerId
      )
        await ctx.runAction(api.live.recovery.inspect, {
          key: target.key,
          operationId: original.operationId,
          generation: original.generation,
          providerId: original.reference.providerId,
        });
    }
    return ctx.runQuery(api.live.cleanup.status, input);
  },
});
/** Reset affects presentation only. Ownership, component journals and cumulative counters are immutable here. */
export const resetView = mutation({
  args: confirmedArgs,
  returns: v.null(),
  handler: async (ctx, input) => {
    const operator = await requireOperator(ctx),
      view = await read(ctx, input.runId);
    if (
      !view.canReset ||
      input.confirmation !== input.runId ||
      input.reviewToken !== view.reviewToken
    )
      refuse(
        "Retain recovery records until every intent is resolved and the 24-hour retention period has passed.",
      );
    await ctx.db.insert("liveCleanupArchives", {
      scope: operator.scope,
      runId: input.runId,
      archivedAt: Date.now(),
    });
    return null;
  },
});
