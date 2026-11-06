import {
  action,
  internalMutation,
  internalQuery,
  query,
} from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { components, internal } from "../_generated/api";
import { v } from "convex/values";
import { readBoatSetup } from "@fantastic.dev/convex-sandbox/boat";
import { requireOperator } from "./operator";
import {
  admissionKind,
  approvalValidator,
  configuredPlan,
  currentPlan,
  planValidator,
  refuse,
  reservationStatus,
  reviewToken,
} from "./allowanceModel";

export const proposal = query({
  args: {},
  returns: v.object({
    plan: v.union(planValidator, v.null()),
    reviewToken: v.union(v.string(), v.null()),
    approval: v.union(approvalValidator, v.null()),
  }),
  handler: async (ctx) => {
    const operator = await requireOperator(ctx);
    const plan = configuredPlan(operator.scope);
    const approval = await ctx.db
      .query("liveApprovals")
      .withIndex("by_scope", (q) => q.eq("scope", operator.scope))
      .unique();
    return { plan, reviewToken: plan ? reviewToken(plan) : null, approval };
  },
});
export const approve = action({
  args: { reviewToken: v.string(), acknowledgeRisk: v.literal(true) },
  returns: v.id("liveApprovals"),
  handler: async (ctx, args): Promise<Id<"liveApprovals">> => {
    const operator = await requireOperator(ctx);
    const plan = currentPlan(operator.scope, args.reviewToken);
    if (!process.env.BOAT_API_KEY)
      refuse("Boat account configuration is required before approval.");
    let account: Awaited<ReturnType<typeof readBoatSetup>>;
    try {
      account = await readBoatSetup({
        apiKey: process.env.BOAT_API_KEY,
        org: plan.wallet,
      });
    } catch {
      refuse(
        "Boat account identity could not be verified. No approval was recorded.",
      );
    }
    if (
      account.accountId !== plan.accountId ||
      account.walletTeamId !== plan.walletTeamId
    )
      refuse("Boat account does not match the reviewed run.");
    return ctx.runMutation(internal.live.allowance.recordApproval, args);
  },
});
export const recordApproval = internalMutation({
  args: { reviewToken: v.string(), acknowledgeRisk: v.literal(true) },
  returns: v.id("liveApprovals"),
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const plan = currentPlan(operator.scope, args.reviewToken);
    const previous = await ctx.db
      .query("liveApprovals")
      .withIndex("by_scope", (q) => q.eq("scope", operator.scope))
      .unique();
    if (previous) {
      if (previous.reviewToken !== args.reviewToken)
        refuse("An existing approval ledger cannot be replaced or reset.");
      return previous._id;
    }
    return ctx.db.insert("liveApprovals", {
      scope: operator.scope,
      plan,
      reviewToken: args.reviewToken,
      approvedAt: Date.now(),
      approvedBy: { issuer: operator.issuer, subject: operator.subject },
      machinesReserved: 0,
      startsReserved: 0,
      activeReservations: 0,
      estimatedUsdReserved: 0,
    });
  },
});
/** Trusted host actions must obtain this atomic reservation before any billable dispatch.
 * Repeated intent keys return admitted:false: never replay an uncertain request. */
export const reserve = internalMutation({
  args: {
    runId: v.string(),
    intentKey: v.string(),
    machineKey: v.string(),
    kind: admissionKind,
  },
  returns: v.object({
    reservationId: v.id("liveReservations"),
    admitted: v.boolean(),
    status: reservationStatus,
  }),
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    for (const value of [args.intentKey, args.machineKey])
      if (!/^[a-zA-Z0-9._-]{1,100}$/.test(value))
        refuse("Invalid admission intent.");
    const approval = await ctx.db
      .query("liveApprovals")
      .withIndex("by_scope", (q) => q.eq("scope", operator.scope))
      .unique();
    if (!approval || approval.plan.runId !== args.runId)
      refuse("Explicit approval is required for this run.");
    const prior = await ctx.db
      .query("liveReservations")
      .withIndex("by_scope_and_runId_and_intentKey", (q) =>
        q
          .eq("scope", operator.scope)
          .eq("runId", args.runId)
          .eq("intentKey", args.intentKey),
      )
      .unique();
    if (prior) {
      if (prior.kind !== args.kind || prior.machineKey !== args.machineKey)
        refuse("The admission intent is already bound to different work.");
      return {
        reservationId: prior._id,
        admitted: false,
        status: prior.status,
      };
    }
    if (args.kind === "start") {
      const outstanding = await ctx.db
        .query("liveReservations")
        .withIndex("by_scope_and_machineKey_and_kind", (q) =>
          q
            .eq("scope", operator.scope)
            .eq("machineKey", args.machineKey)
            .eq("kind", "start"),
        )
        .take(5);
      if (outstanding.some((row) => row.status !== "released"))
        refuse(
          "This machine already has a retained resume admission. Inspect the original intent.",
        );
    }
    const plan = currentPlan(operator.scope, approval.reviewToken);
    if (Date.now() >= approval.approvedAt + plan.durationMinutes * 60_000)
      refuse("Run duration has expired.");
    const machines = args.kind === "start" ? 0 : 1;
    const cost =
      Math.ceil((plan.estimateUsd * 1_000_000) / plan.maxStarts) / 1_000_000;
    if (
      approval.activeReservations >= plan.maxConcurrent ||
      approval.machinesReserved + machines > plan.maxMachines ||
      approval.startsReserved + 1 > plan.maxStarts ||
      approval.estimatedUsdReserved + cost > plan.allowanceUsd
    )
      refuse(
        "Run admission limit reached. Existing reservations remain counted.",
      );
    const reservationId = await ctx.db.insert("liveReservations", {
      ...args,
      scope: operator.scope,
      approvalId: approval._id,
      status: "reserved",
      estimatedUsd: cost,
      createdAt: Date.now(),
    });
    await ctx.db.patch(approval._id, {
      machinesReserved: approval.machinesReserved + machines,
      startsReserved: approval.startsReserved + 1,
      activeReservations: approval.activeReservations + 1,
      estimatedUsdReserved: approval.estimatedUsdReserved + cost,
    });
    return { reservationId, admitted: true, status: "reserved" as const };
  },
});
export const markUnknown = internalMutation({
  args: { reservationId: v.id("liveReservations") },
  returns: v.null(),
  handler: async (ctx, { reservationId }) => {
    const operator = await requireOperator(ctx);
    const row = await ctx.db.get(reservationId);
    if (!row || row.scope !== operator.scope)
      refuse("Reservation access denied.");
    if (row.status !== "released")
      await ctx.db.patch(reservationId, { status: "unknown" });
    return null;
  },
});

/** Release only concurrency after an exact successful stop. Cumulative allowance never resets. */
export const releaseStopped = internalMutation({
  args: { key: v.string(), operationId: v.string() },
  returns: v.null(),
  handler: async (ctx, { key, operationId }) => {
    const operator = await requireOperator(ctx);
    const sandbox = { scope: operator.scope, key };
    const row = await ctx.runQuery(components.sandbox.registry.get, {
      sandbox,
    });
    const stop = await ctx.runQuery(components.sandbox.operations.get, {
      sandbox,
      operationId,
    });
    if (
      !row ||
      row.tombstone ||
      row.observedState !== "stopped" ||
      row.activeOperationId ||
      !stop ||
      stop.kind !== "stop" ||
      stop.status !== "succeeded" ||
      stop.generation !== row.generation ||
      stop.reference.provider !== "boat" ||
      stop.reference.providerId !== row.reference.providerId
    )
      refuse(
        "A completed exact-owned stop is required to release concurrency.",
      );
    const provision = await ctx.runQuery(
      components.sandbox.lifecycle.getProvision,
      { sandbox },
    );
    const candidates = (
      await Promise.all(
        (["create", "start"] as const).map((kind) =>
          ctx.db
            .query("liveReservations")
            .withIndex("by_scope_and_machineKey_and_kind", (q) =>
              q
                .eq("scope", operator.scope)
                .eq("machineKey", key)
                .eq("kind", kind),
            )
            .take(5),
        ),
      )
    ).flat();
    for (const candidate of candidates) {
      if (candidate.status === "released") continue;
      let confirmed = false;
      if (candidate.kind === "create")
        confirmed =
          provision?.status === "succeeded" &&
          provision.operationId === candidate.intentKey &&
          provision.reference?.provider === "boat" &&
          provision.reference.providerId === row.reference.providerId;
      else {
        const start = await ctx.runQuery(components.sandbox.operations.get, {
          sandbox,
          operationId: candidate.intentKey,
        });
        confirmed = Boolean(
          start &&
          start.kind === "start" &&
          start.sequence < stop.sequence &&
          start.generation === row.generation &&
          start.reference.providerId === row.reference.providerId,
        );
      }
      if (!confirmed) continue;
      const approval = await ctx.db.get(candidate.approvalId);
      if (
        !approval ||
        approval.scope !== operator.scope ||
        approval.activeReservations < 1
      )
        refuse("Reservation accounting requires reconciliation.");
      await ctx.db.patch(candidate._id, { status: "released" });
      await ctx.db.patch(approval._id, {
        activeReservations: approval.activeReservations - 1,
      });
    }
    return null;
  },
});

/** Recovery reads the retained approval independently of a malformed/expired proposed plan. */
export const retained = internalQuery({
  args: {},
  returns: v.union(approvalValidator, v.null()),
  handler: async (ctx) => {
    const operator = await requireOperator(ctx);
    return ctx.db
      .query("liveApprovals")
      .withIndex("by_scope", (q) => q.eq("scope", operator.scope))
      .unique();
  },
});
