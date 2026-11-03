import type { PaginationOptions } from "convex/server";
import type { SandboxKey } from "../contracts.js";
import type { Doc } from "./_generated/dataModel.js";
import type { QueryCtx } from "./_generated/server.js";

export function boundedString(value: string, max = 1024) {
  if (!value.length || value.length > max)
    throw new Error("Invalid identity length");
}
export function validateIdentity(sandbox: SandboxKey) {
  boundedString(sandbox.scope);
  boundedString(sandbox.key);
}
export function integer(value: number) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid version or sequence");
}
export function pagination(opts: PaginationOptions): PaginationOptions {
  if (
    !Number.isSafeInteger(opts.numItems) ||
    opts.numItems < 1 ||
    opts.numItems > 100
  )
    throw new Error("Page size must be 1..100");
  return { ...opts, maximumRowsRead: 1000, maximumBytesRead: 1024 * 1024 };
}
export async function findSandbox(
  ctx: Pick<QueryCtx, "db">,
  sandbox: SandboxKey,
) {
  validateIdentity(sandbox);
  return ctx.db
    .query("sandboxes")
    .withIndex("by_scope_and_key", (q) =>
      q.eq("scope", sandbox.scope).eq("key", sandbox.key),
    )
    .unique();
}
export async function mustSandbox(
  ctx: Pick<QueryCtx, "db">,
  sandbox: SandboxKey,
) {
  const row = await findSandbox(ctx, sandbox);
  if (!row) throw new Error("Sandbox missing");
  return row;
}
export function registryRecord(row: Doc<"sandboxes">) {
  const {
    _id,
    _creationTime: _time,
    operationCount: _count,
    nextSequence: _sequence,
    ...record
  } = row;
  return record;
}
export function operationRecord(row: Doc<"operations">) {
  const { _id, _creationTime: _time, ...record } = row;
  return record;
}
