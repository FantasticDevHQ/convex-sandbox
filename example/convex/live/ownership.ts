"use node";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import {
  retainOwnership,
  type WorktreeOwner,
} from "../../../scripts/worktree/boat-ownership-store.mjs";

/** Local-only export. No caller-supplied scope, account, paths or lifecycle authority. */
export const retain = internalAction({
  args: {
    key: v.string(),
    kind: v.union(v.literal("create"), v.literal("fork")),
    nativeId: v.optional(v.string()),
    generation: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const raw = process.env.EXAMPLE_WORKTREE_OWNERSHIP;
    if (!raw)
      throw Error(
        "Managed worktree ownership is required before Boat creation.",
      );
    const owner: WorktreeOwner = JSON.parse(raw);
    const cloud = new URL(process.env.CONVEX_CLOUD_URL ?? "http://invalid");
    if (
      cloud.protocol !== "http:" ||
      cloud.hostname !== "127.0.0.1" ||
      Number(cloud.port) !== owner.cloudPort
    )
      throw Error("Ownership export requires a local backend.");
    const intent = await ctx.runQuery(internal.live.ownershipData.snapshot, {
      key: args.key,
      kind: args.kind,
    });
    await retainOwnership(owner, intent.intent, {
      ...(args.nativeId
        ? { nativeId: args.nativeId }
        : intent.nativeId
          ? { nativeId: intent.nativeId }
          : {}),
      ...(args.generation
        ? { generation: args.generation }
        : intent.generation
          ? { generation: intent.generation }
          : {}),
    });
    return null;
  },
});
