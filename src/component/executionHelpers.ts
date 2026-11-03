import type { QueryCtx, MutationCtx } from "./_generated/server.js";
import type { Doc } from "./_generated/dataModel.js";
import type { CommandHandle } from "../execution.js";
import {
  EXECUTION_LOG_BYTES,
  EXECUTION_LOG_CHUNKS,
  LOG_CHUNK_BYTES,
} from "../execution.js";
import { truncateUtf8 } from "../output.js";
import { boundedString, validateIdentity } from "./stateHelpers.js";

export const terminalExecution = (state: string) =>
  ["completed", "failed", "cancelled"].includes(state);
export async function findExecution(
  ctx: Pick<QueryCtx, "db">,
  { sandbox, operationId }: CommandHandle,
) {
  validateIdentity(sandbox);
  boundedString(operationId, 256);
  return ctx.db
    .query("executions")
    .withIndex("by_scope_and_key_and_operationId", (q) =>
      q
        .eq("scope", sandbox.scope)
        .eq("key", sandbox.key)
        .eq("operationId", operationId),
    )
    .unique();
}
export function executionRecord(row: Doc<"executions">) {
  const {
    _id,
    _creationTime: _time,
    statusVersion: _sv,
    statusLeaseUntil: _sl,
    cancelVersion: _cv,
    cancelLeaseUntil: _cl,
    cancelDispatched: _cd,
    logVersion: _lv,
    logLeaseUntil: _ll,
    providerCursor: _cursor,
    logsComplete: _complete,
    chunkCount: _count,
    ...record
  } = row;
  return record;
}
export async function appendOutput(
  ctx: MutationCtx,
  row: Doc<"executions">,
  entries: { stream: "stdout" | "stderr"; text: string }[],
) {
  let bytes = row.outputBytes,
    count = row.chunkCount,
    truncated = row.outputTruncated;
  for (const entry of entries.slice(0, 16)) {
    const bounded = truncateUtf8(
      entry.text,
      Math.min(LOG_CHUNK_BYTES, Math.max(0, EXECUTION_LOG_BYTES - bytes)),
    );
    truncated ||= bounded.truncated;
    if (count >= EXECUTION_LOG_CHUNKS) {
      truncated ||= !!entry.text;
      continue;
    }
    if (bounded.text) {
      await ctx.db.insert("executionLogs", {
        scope: row.scope,
        key: row.key,
        operationId: row.operationId,
        sequence: count,
        stream: entry.stream,
        text: bounded.text,
      });
      bytes += bounded.bytes;
      count++;
    }
  }
  truncated ||= entries.length > 16;
  return { outputBytes: bytes, chunkCount: count, outputTruncated: truncated };
}
export async function pruneExecution(
  ctx: MutationCtx,
  scope: string,
  key: string,
  operationId: string,
) {
  const row = await findExecution(ctx, {
    sandbox: { scope, key },
    operationId,
  });
  if (!row) return;
  if (!terminalExecution(row.state)) throw new Error("Execution is unresolved");
  const chunks = await ctx.db
    .query("executionLogs")
    .withIndex("by_scope_and_key_and_operationId_and_sequence", (q) =>
      q.eq("scope", scope).eq("key", key).eq("operationId", operationId),
    )
    .take(EXECUTION_LOG_CHUNKS);
  for (const chunk of chunks) await ctx.db.delete(chunk._id);
  await ctx.db.delete(row._id);
}
