import { defineTable } from "convex/server";
import { v } from "convex/values";
import { fileIndexValidator, profileValidator } from "./contracts.js";
export const demoTables = {
  demoControl: defineTable({
    key: v.literal("fixture"),
    epoch: v.number(),
    token: v.number(),
    initialized: v.boolean(),
    leaseUntil: v.number(),
  }).index("by_key", ["key"]),
  demoProfiles: defineTable({
    profile: profileValidator,
    epoch: v.number(),
    stateJson: v.string(),
    files: fileIndexValidator,
  }).index("by_profile", ["profile"]),
};
