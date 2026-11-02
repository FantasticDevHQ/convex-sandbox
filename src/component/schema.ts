import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const observationFields = {
  scope: v.string(),
  key: v.string(),
  provider: v.string(),
  providerId: v.string(),
  state: v.union(v.literal("running"), v.literal("stopped")),
};

export default defineSchema({
  observations: defineTable(observationFields).index("by_scope_and_key", ["scope", "key"]),
});
