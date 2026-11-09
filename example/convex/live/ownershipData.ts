import { internalQuery } from "../_generated/server";
import { components } from "../_generated/api";
import { v } from "convex/values";
import { requireOperator } from "./operator";
import { refuse } from "./allowanceModel";

export const snapshot = internalQuery({
  args: {
    key: v.string(),
    kind: v.union(v.literal("create"), v.literal("fork")),
  },
  returns: v.object({
    intent: v.object({
      scope: v.string(),
      key: v.string(),
      kind: v.union(v.literal("create"), v.literal("fork")),
      reservationId: v.string(),
      operationId: v.string(),
      runId: v.string(),
      accountId: v.string(),
      wallet: v.string(),
      walletTeamId: v.union(v.string(), v.null()),
      parent: v.union(
        v.null(),
        v.object({
          key: v.string(),
          nativeId: v.string(),
          generation: v.number(),
        }),
      ),
    }),
    nativeId: v.union(v.string(), v.null()),
    generation: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, { key, kind }) => {
    const { scope } = await requireOperator(ctx);
    const reservation = await ctx.db
      .query("liveReservations")
      .withIndex("by_scope_and_machineKey_and_kind", (q) =>
        q.eq("scope", scope).eq("machineKey", key).eq("kind", kind),
      )
      .unique();
    if (!reservation) refuse("Original creation admission required.");
    const approval = await ctx.db.get(reservation.approvalId);
    if (
      !approval ||
      approval.scope !== scope ||
      approval.plan.runId !== reservation.runId
    )
      refuse("Original run required.");
    const plan = approval.plan;
    let parent: { key: string; nativeId: string; generation: number } | null =
      null;
    let nativeId: string | null = null,
      generation: number | null = null;
    if (kind === "fork") {
      const fork = await ctx.db
        .query("liveForks")
        .withIndex("by_scope_and_childKey", (q) =>
          q.eq("scope", scope).eq("childKey", key),
        )
        .unique();
      if (
        !fork ||
        fork.reservationId !== reservation._id ||
        fork.operationId !== reservation.intentKey
      )
        refuse("Original fork required.");
      parent = {
        key: fork.sourceKey,
        nativeId: fork.sourceId,
        generation: fork.sourceGeneration,
      };
      const op = await ctx.runQuery(components.sandbox.operations.get, {
        sandbox: { scope, key: fork.sourceKey },
        operationId: fork.operationId,
      });
      if (
        op?.generation === fork.sourceGeneration &&
        op.reference.providerId === fork.sourceId
      ) {
        const result = op.nativeImage?.result;
        const ref =
          op.nativeImage?.acceptedMachine ??
          (result && "machine" in result ? result.machine : null);
        if (ref?.provider === "boat") nativeId = ref.providerId;
      }
      generation = fork.childGeneration ?? null;
    } else {
      const provision = await ctx.runQuery(
        components.sandbox.lifecycle.getProvision,
        { sandbox: { scope, key } },
      );
      if (
        provision?.operationId === reservation.intentKey &&
        provision.reference?.provider === "boat"
      )
        nativeId = provision.reference.providerId;
    }
    const row = await ctx.runQuery(components.sandbox.registry.get, {
      sandbox: { scope, key },
    });
    if (
      nativeId &&
      row?.reference.provider === "boat" &&
      row.reference.providerId === nativeId
    )
      generation = row.generation;
    return {
      intent: {
        scope,
        key,
        kind,
        reservationId: String(reservation._id),
        operationId: reservation.intentKey,
        runId: reservation.runId,
        accountId: plan.accountId,
        wallet: plan.wallet,
        walletTeamId: plan.walletTeamId,
        parent,
      },
      nativeId,
      generation,
    };
  },
});
