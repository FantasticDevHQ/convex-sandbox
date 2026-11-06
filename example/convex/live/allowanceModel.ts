import { ConvexError, v, type Infer } from "convex/values";
export const planValidator = v.object({
  runId: v.string(),
  scope: v.string(),
  accountId: v.string(),
  wallet: v.string(),
  walletTeamId: v.union(v.string(), v.null()),
  size: v.literal("small"),
  expiresAt: v.number(),
  maxMachines: v.number(),
  maxStarts: v.number(),
  maxConcurrent: v.number(),
  durationMinutes: v.number(),
  estimateUsd: v.number(),
  allowanceUsd: v.number(),
});
export type RunPlan = Infer<typeof planValidator>;
export const approvalFields = {
  scope: v.string(),
  plan: planValidator,
  reviewToken: v.string(),
  approvedAt: v.number(),
  approvedBy: v.object({ issuer: v.string(), subject: v.string() }),
  machinesReserved: v.number(),
  startsReserved: v.number(),
  activeReservations: v.number(),
  estimatedUsdReserved: v.number(),
};
export const approvalValidator = v.object({
  _id: v.id("liveApprovals"),
  _creationTime: v.number(),
  ...approvalFields,
});
export const admissionKind = v.union(
  v.literal("create"),
  v.literal("fork"),
  v.literal("start"),
);
export const reservationStatus = v.union(
  v.literal("reserved"),
  v.literal("unknown"),
  v.literal("released"),
);
export const reservationFields = {
  scope: v.string(),
  runId: v.string(),
  intentKey: v.string(),
  machineKey: v.string(),
  kind: admissionKind,
  status: reservationStatus,
  approvalId: v.id("liveApprovals"),
  estimatedUsd: v.number(),
  createdAt: v.number(),
};
export function refuse(message: string): never {
  throw new ConvexError({ code: "authorization", message });
}
const fields = [
  "runId",
  "scope",
  "accountId",
  "wallet",
  "walletTeamId",
  "size",
  "expiresAt",
  "maxMachines",
  "maxStarts",
  "maxConcurrent",
  "durationMinutes",
  "estimateUsd",
  "allowanceUsd",
];
/** An explicitly reviewed host proposal, never a default spending plan. */
export function configuredPlan(scope: string): RunPlan | null {
  const raw = process.env.EXAMPLE_LIVE_RUN_PLAN;
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    if (
      Object.keys(p).length !== fields.length ||
      fields.some((k) => !(k in p))
    )
      throw Error();
    for (const key of ["runId", "scope", "accountId", "wallet"])
      if (
        typeof p[key] !== "string" ||
        !/^[a-zA-Z0-9:._/-]{1,160}$/.test(p[key])
      )
        throw Error();
    if (
      p.walletTeamId !== null &&
      (typeof p.walletTeamId !== "string" ||
        !/^[a-zA-Z0-9_-]{1,160}$/.test(p.walletTeamId))
    )
      throw Error();
    if ((p.wallet === "personal") !== (p.walletTeamId === null)) throw Error();
    for (const [key, max] of [
      ["maxMachines", 2],
      ["maxStarts", 4],
      ["maxConcurrent", 2],
      ["durationMinutes", 60],
    ] as const)
      if (!Number.isSafeInteger(p[key]) || p[key] < 1 || p[key] > max)
        throw Error();
    if (
      p.size !== "small" ||
      p.maxConcurrent > p.maxMachines ||
      p.maxStarts < p.maxMachines
    )
      throw Error();
    if (!Number.isSafeInteger(p.expiresAt) || p.expiresAt < 1) throw Error();
    if (
      !Number.isFinite(p.estimateUsd) ||
      !Number.isFinite(p.allowanceUsd) ||
      p.estimateUsd <= 0 ||
      p.allowanceUsd < p.estimateUsd ||
      p.allowanceUsd > 100
    )
      throw Error();
    if (process.env.BOAT_API_KEY && raw.includes(process.env.BOAT_API_KEY))
      throw Error();
    // Canonical field order makes the review token stable and sensitive to every reviewed limit.
    const plan = Object.fromEntries(fields.map((k) => [k, p[k]])) as RunPlan;
    return plan.scope === scope ? plan : null;
  } catch {
    refuse(
      "The host run proposal is invalid. Ask the host owner to review its configuration.",
    );
  }
}
export const reviewToken = (plan: RunPlan) => JSON.stringify(plan);
export function currentPlan(scope: string, token?: string): RunPlan {
  const plan = configuredPlan(scope);
  if (!plan)
    refuse("No reviewed run proposal is configured for this operator.");
  if (token !== undefined && token !== reviewToken(plan))
    refuse("The run proposal changed. Review it again.");
  if (plan.expiresAt <= Date.now()) refuse("Run approval has expired.");
  if (plan.expiresAt > Date.now() + 24 * 60 * 60 * 1000)
    refuse("Run expiry must be within 24 hours.");
  if (plan.wallet !== (process.env.BOAT_ORG ?? "personal"))
    refuse("The configured Boat wallet does not match the reviewed run.");
  return plan;
}
