import { pruneExecution, findExecution } from "./executionHelpers.js";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import {
  mutation,
  query,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server.js";
import { sandboxKeyValidator, type SandboxKey } from "../contracts.js";
import {
  capabilityValidator,
  providerErrorCodeValidator,
} from "../capabilities.js";
import {
  operationRecordValidator,
  trackedOperationStatusValidator,
  operationPageValidator,
  OPERATION_HISTORY_LIMIT,
} from "../state.js";
import {
  boundedString,
  integer,
  mustSandbox,
  operationRecord,
  pagination,
  validateIdentity,
} from "./stateHelpers.js";

async function findOperation(
  ctx: Pick<QueryCtx, "db">,
  sandbox: SandboxKey,
  operationId: string,
) {
  validateIdentity(sandbox);
  boundedString(operationId, 256);
  return ctx.db
    .query("operations")
    .withIndex("by_scope_and_key_and_operationId", (q) =>
      q
        .eq("scope", sandbox.scope)
        .eq("key", sandbox.key)
        .eq("operationId", operationId),
    )
    .unique();
}
const mutates = (kind: string) =>
  ![
    "describe",
    "readFile",
    "listFiles",
    "listTemplates",
    "getConnection",
    "executionLogs",
  ].includes(kind);
const terminal = (status: string) =>
  status === "succeeded" || status === "failed" || status === "cancelled";

export const begin = mutation({
  args: {
    sandbox: sandboxKeyValidator,
    expectedVersion: v.number(),
    operationId: v.string(),
    kind: capabilityValidator,
  },
  returns: operationRecordValidator,
  handler: beginOperation,
});
export async function beginOperation(
  ctx: MutationCtx,
  {
    sandbox,
    expectedVersion,
    operationId,
    kind,
  }: {
    sandbox: SandboxKey;
    expectedVersion: number;
    operationId: string;
    kind: import("../capabilities.js").Capability;
  },
): Promise<import("../state.js").OperationRecord> {
  integer(expectedVersion);
  const row = await mustSandbox(ctx, sandbox);
  const existing = await findOperation(ctx, sandbox, operationId);
  if (existing) {
    if (existing.generation !== row.generation || existing.kind !== kind)
      throw new Error("Operation identity conflict");
    return operationRecord(existing);
  }
  if (row.version !== expectedVersion) throw new Error("Version conflict");
  if (row.tombstone) throw new Error("Sandbox deleted");
  if (row.activeOperationId) throw new Error("Operation active");
  if (row.operationCount >= OPERATION_HISTORY_LIMIT) {
    const oldest = await ctx.db
      .query("operations")
      .withIndex("by_scope_and_key_and_sequence", (q) =>
        q.eq("scope", sandbox.scope).eq("key", sandbox.key),
      )
      .first();
    if (!oldest || !terminal(oldest.status))
      throw new Error("History capacity reached");
    await pruneExecution(ctx, sandbox.scope, sandbox.key, oldest.operationId);
    await ctx.db.delete(oldest._id);
  }
  const now = Date.now();
  const value = {
    ...sandbox,
    operationId,
    kind,
    reference: row.reference,
    generation: row.generation,
    sequence: row.nextSequence + 1,
    version: 1,
    status: "pending" as const,
    createdAt: now,
    updatedAt: now,
  };
  await ctx.db.insert("operations", value);
  const requestedState =
    kind === "start" || kind === "resumeMemory"
      ? "running"
      : kind === "stop"
        ? "stopped"
        : kind === "delete"
          ? "deleted"
          : row.requestedState;
  await ctx.db.patch(row._id, {
    activeOperationId: operationId,
    requestedState,
    ...(mutates(kind)
      ? {
          refreshSequence: row.refreshSequence + 1,
          refresh: { status: "stale" as const },
        }
      : {}),
    nextSequence: value.sequence,
    operationCount: Math.min(row.operationCount + 1, OPERATION_HISTORY_LIMIT),
    version: row.version + 1,
    updatedAt: now,
  });
  return value;
}
export const transition = mutation({
  args: {
    sandbox: sandboxKeyValidator,
    operationId: v.string(),
    expectedVersion: v.number(),
    status: trackedOperationStatusValidator,
    executionId: v.optional(v.string()),
    errorCode: v.optional(providerErrorCodeValidator),
  },
  returns: v.boolean(),
  handler: async (
    ctx,
    { sandbox, operationId, expectedVersion, status, executionId, errorCode },
  ) => {
    integer(expectedVersion);
    const row = await mustSandbox(ctx, sandbox);
    const op = await findOperation(ctx, sandbox, operationId);
    if (!op) throw new Error("Operation missing");
    if (op.nativeImage) throw new Error("Use the image state protocol");
    if (
      op.kind === "execute" &&
      (await findExecution(ctx, { sandbox, operationId }))
    )
      throw new Error("Use the execution state protocol");
    if (
      (op.leaseUntil !== undefined &&
        op.leaseUntil > 0 &&
        op.leaseUntil <= Date.now()) ||
      op.version !== expectedVersion ||
      op.generation !== row.generation
    )
      return false;
    if (
      terminal(op.status) ||
      status === "pending" ||
      status === op.status ||
      (op.status === "unknown" && !terminal(status))
    )
      throw new Error("Invalid operation transition");
    if (executionId !== undefined) {
      boundedString(executionId);
      if (
        op.kind !== "execute" ||
        (op.executionId && op.executionId !== executionId)
      )
        throw new Error("Execution identity conflict");
    }
    await ctx.db.patch(op._id, {
      status,
      executionId: executionId ?? op.executionId,
      errorCode,
      leaseUntil: terminal(status) || status === "unknown" ? 0 : op.leaseUntil,
      version: op.version + 1,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(row._id, {
      activeOperationId: terminal(status) ? undefined : operationId,
      ...(mutates(op.kind) && !row.tombstone
        ? {
            refreshSequence: row.refreshSequence + 1,
            refresh: { status: "stale" as const },
          }
        : {}),
      version: row.version + 1,
      updatedAt: Date.now(),
    });
    return true;
  },
});
export const get = query({
  args: { sandbox: sandboxKeyValidator, operationId: v.string() },
  returns: v.union(v.null(), operationRecordValidator),
  handler: async (ctx, { sandbox, operationId }) => {
    const row = await findOperation(ctx, sandbox, operationId);
    return row ? operationRecord(row) : null;
  },
});
export const list = query({
  args: {
    sandbox: sandboxKeyValidator,
    paginationOpts: paginationOptsValidator,
  },
  returns: operationPageValidator,
  handler: async (ctx, { sandbox, paginationOpts }) => {
    validateIdentity(sandbox);
    const result = await ctx.db
      .query("operations")
      .withIndex("by_scope_and_key_and_sequence", (q) =>
        q.eq("scope", sandbox.scope).eq("key", sandbox.key),
      )
      .order("desc")
      .paginate(pagination(paginationOpts));
    return {
      page: result.page.map(operationRecord),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});
export const executions = query({
  args: {
    sandbox: sandboxKeyValidator,
    paginationOpts: paginationOptsValidator,
  },
  returns: operationPageValidator,
  handler: async (ctx, { sandbox, paginationOpts }) => {
    validateIdentity(sandbox);
    const result = await ctx.db
      .query("operations")
      .withIndex("by_scope_and_key_and_kind_and_sequence", (q) =>
        q
          .eq("scope", sandbox.scope)
          .eq("key", sandbox.key)
          .eq("kind", "execute"),
      )
      .order("desc")
      .paginate(pagination(paginationOpts));
    return {
      page: result.page.map(operationRecord),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});
