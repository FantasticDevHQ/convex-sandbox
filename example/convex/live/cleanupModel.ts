import { v, type Infer } from "convex/values";
export const CLEANUP_RETENTION_MS = 24 * 60 * 60 * 1000;
export const cleanupTargetValidator = v.object({
  key: v.string(),
  kind: v.union(v.literal("create"), v.literal("fork")),
  operationId: v.string(),
  providerId: v.union(v.string(), v.null()),
  generation: v.union(v.number(), v.null()),
  phase: v.union(
    v.literal("ready"),
    v.literal("pending"),
    v.literal("unresolved"),
    v.literal("confirmed"),
    v.literal("not_created"),
  ),
  reason: v.string(),
  deleteToken: v.union(v.string(), v.null()),
});
export const cleanupViewValidator = v.object({
  runId: v.string(),
  targets: v.array(cleanupTargetValidator),
  unresolvedIntents: v.array(v.string()),
  truncated: v.boolean(),
  complete: v.boolean(),
  reviewToken: v.string(),
  canReset: v.boolean(),
  resetAfter: v.union(v.number(), v.null()),
  archivedAt: v.union(v.number(), v.null()),
});
export type CleanupView = Infer<typeof cleanupViewValidator>;
export type CleanupTarget = Infer<typeof cleanupTargetValidator>;
