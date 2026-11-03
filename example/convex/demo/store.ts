import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
  type MutationCtx,
} from "../_generated/server.js";
import { createSimulatedProvider } from "@fantastic.dev/convex-sandbox/testing";
import {
  localFixture,
  deny,
  profileValidator,
  providerFor,
  leaseValidator,
  leaseArgs,
} from "./contracts.js";
export const control = (ctx: Pick<QueryCtx, "db">) =>
  ctx.db
    .query("demoControl")
    .withIndex("by_key", (q) => q.eq("key", "fixture"))
    .unique();
async function owned(ctx: Pick<QueryCtx, "db">, epoch: number, token: number) {
  localFixture();
  const row = await control(ctx);
  if (
    !row ||
    row.epoch !== epoch ||
    row.token !== token ||
    row.leaseUntil <= Date.now()
  )
    deny("capacity");
  return row;
}
export const acquire = internalMutation({
  args: { reset: v.boolean() },
  returns: leaseValidator,
  handler: async (ctx, { reset }) => {
    localFixture();
    const row = await control(ctx);
    if (row && row.leaseUntil > Date.now()) deny("capacity");
    const value = {
      key: "fixture" as const,
      epoch: row ? row.epoch + (reset ? 1 : 0) : 1,
      token: (row?.token ?? 0) + 1,
      initialized: reset ? false : (row?.initialized ?? false),
      leaseUntil: Date.now() + 60000,
    };
    if (row) await ctx.db.replace(row._id, value);
    else await ctx.db.insert("demoControl", value);
    return {
      epoch: value.epoch,
      token: value.token,
      initialized: value.initialized,
    };
  },
});
export const release = internalMutation({
  args: leaseArgs,
  returns: v.null(),
  handler: async (ctx, { epoch, token }) => {
    localFixture();
    const row = await control(ctx);
    if (row?.epoch === epoch && row.token === token)
      await ctx.db.patch(row._id, { leaseUntil: 0 });
    return null;
  },
});
export const complete = internalMutation({
  args: leaseArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await owned(ctx, args.epoch, args.token);
    await ctx.db.patch(row._id, { initialized: true });
    return null;
  },
});
export const load = internalQuery({
  args: { ...leaseArgs, profile: profileValidator },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    await owned(ctx, args.epoch, args.token);
    const row = await ctx.db
      .query("demoProfiles")
      .withIndex("by_profile", (q) => q.eq("profile", args.profile))
      .unique();
    return row?.epoch === args.epoch ? row.stateJson : null;
  },
});
export const save = internalMutation({
  args: { ...leaseArgs, profile: profileValidator, stateJson: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await owned(ctx, args.epoch, args.token);
    if (
      args.stateJson.length > 524288 ||
      new TextEncoder().encode(args.stateJson).length > 524288
    )
      deny("validation");
    const state = createSimulatedProvider({
      name: providerFor(args.profile),
      profile: args.profile,
      state: JSON.parse(args.stateJson),
    }).snapshot();
    const live = state.machines.filter(
      (machine) => machine.state !== "deleted",
    );
    if (live.length > 1) deny("validation");
    const files = live.flatMap((machine) =>
      machine.files.map((file) => ({
        path: file.path,
        sizeBytes: file.bytes.length,
      })),
    );
    const row = await ctx.db
      .query("demoProfiles")
      .withIndex("by_profile", (q) => q.eq("profile", args.profile))
      .unique();
    const value = {
      profile: args.profile,
      epoch: args.epoch,
      stateJson: args.stateJson,
      files,
    };
    if (row) await ctx.db.replace(row._id, value);
    else await ctx.db.insert("demoProfiles", value);
    return null;
  },
});
// Query handlers can use this indexed helper without returning private fixture state.
export async function profileFiles(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  profile: "ephemeral" | "persistent" | "memory",
  epoch: number,
) {
  const row = await ctx.db
    .query("demoProfiles")
    .withIndex("by_profile", (q) => q.eq("profile", profile))
    .unique();
  return row?.epoch === epoch ? row.files : [];
}
