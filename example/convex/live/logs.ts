import { v } from "convex/values";
import { query, action } from "../_generated/server";
import { api, components } from "../_generated/api";
import {
  cachedLogPageValidator,
  executionRecordValidator,
  createExecutionStore,
  type CachedLogPage,
  type ExecutionRecord,
} from "@fantastic.dev/convex-sandbox";
import { requireOperator } from "./operator";
import { ownedBoatClient } from "./boatHost";
import { refuse } from "./allowanceModel";
const args = { key: v.string(), operationId: v.string() };

// Read the entire bounded shared cache in at most two indexed pages. React
// replaces this snapshot; it never concatenates overlapping query results.
export const cached = query({
  args,
  returns: v.union(cachedLogPageValidator, v.null()),
  handler: async (ctx, handle): Promise<CachedLogPage | null> => {
    const operator = await requireOperator(ctx);
    const record = await ctx.runQuery(api.live.commands.get, handle);
    if (!record) return null;
    const input = {
      sandbox: { scope: operator.scope, key: handle.key },
      operationId: handle.operationId,
      limit: 16,
    };
    const first = await ctx.runQuery(components.sandbox.execution.logs, {
      ...input,
      cursor: null,
    });
    if (first.isDone) return first;
    const second = await ctx.runQuery(components.sandbox.execution.logs, {
      ...input,
      cursor: first.nextCursor,
    });
    return {
      ...second,
      entries: [...first.entries, ...second.entries],
      truncated: first.truncated || second.truncated,
    };
  },
});

// No caller-provided native offset. The shared client's durable log lease owns
// the provider cursor, even after reload, concurrent actions or host restart.
export const sync = action({
  args,
  returns: executionRecordValidator,
  handler: async (ctx, handle): Promise<ExecutionRecord> => {
    await requireOperator(ctx);
    const record = await ctx.runQuery(api.live.commands.get, handle);
    if (!record?.executionId)
      refuse(
        "The original native history identity is required to read output.",
      );
    const client = await ownedBoatClient(ctx, handle.key, "executionLogs");
    await client.providers
      .execution(createExecutionStore(ctx, components.sandbox))
      .syncLogs({
        sandbox: client.sandbox,
        operationId: handle.operationId,
      });
    const current = await ctx.runQuery(api.live.commands.get, handle);
    if (!current) refuse("The selected execution binding changed.");
    return current;
  },
});
