import { ConvexError } from "convex/values";
import type { ActionCtx, QueryCtx } from "../_generated/server";

type Operator = { issuer: string; subject: string; scope: string };

function grants(): Operator[] {
  try {
    const value: unknown = JSON.parse(
      process.env.EXAMPLE_OPERATOR_GRANTS ?? "[]",
    );
    if (!Array.isArray(value) || value.length > 100) return [];
    const seen = new Set<string>();
    for (const entry of value) {
      if (
        !entry ||
        typeof entry !== "object" ||
        Object.keys(entry).sort().join() !== "issuer,scope,subject"
      )
        return [];
      if (
        ![entry.issuer, entry.subject, entry.scope].every(
          (part) =>
            typeof part === "string" &&
            part.trim() === part &&
            part.length > 0 &&
            part.length <= 256,
        )
      )
        return [];
      const key = JSON.stringify([entry.issuer, entry.subject]);
      if (seen.has(key)) return [];
      seen.add(key);
    }
    return value as Operator[];
  } catch {
    return [];
  }
}

/** Every live entry point must resolve authority here before touching provider state. */
export async function requireOperator(
  ctx: Pick<ActionCtx | QueryCtx, "auth">,
): Promise<Operator> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity)
    throw new ConvexError({
      code: "authentication",
      message: "Sign in to access live workflows.",
    });
  const grant = grants().find(
    (candidate) =>
      candidate.issuer === identity.issuer &&
      candidate.subject === identity.subject,
  );
  if (!grant)
    throw new ConvexError({
      code: "authorization",
      message: "Operator access is required.",
    });
  return { issuer: grant.issuer, subject: grant.subject, scope: grant.scope };
}
