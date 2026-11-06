import { action, query } from "../_generated/server";
import { ConvexError, v } from "convex/values";
import { requireOperator } from "./operator";

const operator = { issuer: v.string(), subject: v.string(), scope: v.string() };

/** Read-only authority check. Grants no provisioning or spending approval. */
export const checkAccess = action({
  args: {},
  returns: v.object(operator),
  handler: async (ctx) => requireOperator(ctx),
});

export const session = query({
  args: {},
  returns: v.union(
    v.object({ state: v.literal("authorized"), ...operator }),
    v.object({ state: v.literal("signedOut") }),
    v.object({ state: v.literal("forbidden") }),
  ),
  handler: async (ctx) => {
    try {
      return { state: "authorized" as const, ...(await requireOperator(ctx)) };
    } catch (error) {
      if (!(error instanceof ConvexError)) throw error;
      return {
        state:
          error.data.code === "authentication"
            ? ("signedOut" as const)
            : ("forbidden" as const),
      };
    }
  },
});
