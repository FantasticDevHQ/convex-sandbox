import { v } from "convex/values";
export const fixtureFields = {
  scope: v.string(),
  key: v.string(),
  providerId: v.string(),
  generation: v.number(),
  path: v.string(),
  expectedText: v.string(),
  status: v.union(
    v.literal("preparing"),
    v.literal("written"),
    v.literal("awaiting_resume"),
    v.literal("verified"),
    v.literal("mismatch"),
  ),
  writtenAt: v.optional(v.number()),
  resumeOperationId: v.optional(v.string()),
};
export const fixtureValidator = v.object({
  _id: v.id("liveFixtures"),
  _creationTime: v.number(),
  ...fixtureFields,
});
