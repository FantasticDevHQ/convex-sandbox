import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import { observationFields } from "./schema.js";

/** Experimental boundary proof. Host applications authorize scope before calling. */
export const record = mutation({
  args: observationFields,
  returns: v.null(),
  handler: async (ctx, observation) => {
    const existing = await ctx.db.query("observations")
      .withIndex("by_scope_and_key", q => q.eq("scope", observation.scope).eq("key", observation.key))
      .unique();
    if (existing) await ctx.db.replace(existing._id, observation);
    else await ctx.db.insert("observations", observation);
    return null;
  },
});

export const get = query({
  args: { scope: v.string(), key: v.string() },
  returns: v.union(v.null(), v.object(observationFields)),
  handler: async (ctx, { scope, key }) => {
    const observation = await ctx.db.query("observations")
      .withIndex("by_scope_and_key", q => q.eq("scope", scope).eq("key", key))
      .unique();
    if (!observation) return null;
    return {
      scope: observation.scope,
      key: observation.key,
      provider: observation.provider,
      providerId: observation.providerId,
      state: observation.state,
    };
  },
});
