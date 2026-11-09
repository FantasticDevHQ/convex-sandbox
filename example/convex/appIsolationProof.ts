import { v, type Infer } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
// Internal qualification only. This namespace cannot be produced by the live
// operator scope mapper and confers no provider authority or native identity.
const scope = "app-isolation-proof";
const view = v.object({
  runId: v.string(),
  intentKeys: v.array(v.string()),
  unknown: v.number(),
});
type View = Infer<typeof view>;
async function read(ctx: Pick<QueryCtx, "db">): Promise<View | null> {
  const approval = await ctx.db
    .query("liveApprovals")
    .withIndex("by_scope", (q) => q.eq("scope", scope))
    .unique();
  if (!approval) return null;
  const intents = await ctx.db
    .query("liveReservations")
    .withIndex("by_scope_and_runId_and_intentKey", (q) =>
      q.eq("scope", scope).eq("runId", approval.plan.runId),
    )
    .take(2);
  if (intents.length > 1)
    throw Error("Qualification ledger exceeded its fixture bound");
  return {
    runId: approval.plan.runId,
    intentKeys: intents.map((r) => r.intentKey),
    unknown: intents.filter((r) => r.status === "unknown").length,
  };
}
export const get = internalQuery({
  args: {},
  returns: v.union(view, v.null()),
  handler: read,
});
export const seed = internalMutation({
  args: { runId: v.string() },
  returns: view,
  handler: async (ctx, { runId }) => {
    if (!/^qualification-(alpha|beta)$/.test(runId))
      throw Error("Use only the qualification run namespace");
    const existing = await read(ctx);
    if (existing) {
      if (existing.runId !== runId)
        throw Error("Never replace a retained qualification run");
      return existing;
    }
    const now = Date.now();
    const approvalId = await ctx.db.insert("liveApprovals", {
      scope,
      plan: {
        runId,
        scope,
        accountId: "synthetic-qualification-account",
        wallet: "personal",
        walletTeamId: null,
        size: "small",
        expiresAt: now + 600000,
        maxMachines: 1,
        maxStarts: 1,
        maxConcurrent: 1,
        durationMinutes: 10,
        estimateUsd: 0.1,
        allowanceUsd: 1,
      },
      reviewToken: "<QUALIFICATION_ONLY>",
      approvedAt: now,
      approvedBy: {
        issuer: "https://qualification.invalid",
        subject: "internal-proof",
      },
      machinesReserved: 1,
      startsReserved: 1,
      activeReservations: 1,
      estimatedUsdReserved: 0.1,
    });
    await ctx.db.insert("liveReservations", {
      scope,
      runId,
      intentKey: "qualification-create",
      machineKey: "synthetic-run-machine",
      kind: "create",
      status: "unknown",
      approvalId,
      estimatedUsd: 0.1,
      createdAt: now,
    });
    return { runId, intentKeys: ["qualification-create"], unknown: 1 };
  },
});

/** Fixed synthetic app ledger exported by the local Node runtime qualification. */
export const ownershipSnapshot = internalQuery({
  args: {},
  handler: async (ctx) => {
    const view = await read(ctx);
    if (!view) throw Error("Seed the isolated qualification ledger first");
    const reservation = await ctx.db
      .query("liveReservations")
      .withIndex("by_scope_and_runId_and_intentKey", (q) =>
        q
          .eq("scope", scope)
          .eq("runId", view.runId)
          .eq("intentKey", "qualification-create"),
      )
      .unique();
    if (!reservation) throw Error("Missing original qualification admission");
    const approval = await ctx.db.get(reservation.approvalId);
    if (!approval) throw Error("Missing original qualification approval");
    return {
      scope,
      runId: view.runId,
      operationId: reservation.intentKey,
      reservationId: String(reservation._id),
      key: reservation.machineKey,
      kind: "create" as const,
      accountId: approval.plan.accountId,
      wallet: approval.plan.wallet,
      walletTeamId: approval.plan.walletTeamId,
      parent: null,
    };
  },
});
