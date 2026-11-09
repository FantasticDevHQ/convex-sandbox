"use node";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import {
  retainOwnership,
  type WorktreeOwner,
} from "../../scripts/worktree/boat-ownership-store.mjs";
// No provider requests or public test endpoint. Uses the existing synthetic app ledger.
export const exportIndex = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    const owner: WorktreeOwner = JSON.parse(
      process.env.EXAMPLE_WORKTREE_OWNERSHIP ?? "null",
    );
    const intent = await ctx.runQuery(
      internal.appIsolationProof.ownershipSnapshot,
      {},
    );
    await retainOwnership(owner, intent);
    return null;
  },
});
