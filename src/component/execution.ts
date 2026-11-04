import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import { beginOperation } from "./operations.js";
import { mustSandbox, integer } from "./stateHelpers.js";
import {
  findExecution,
  executionRecord,
  terminalExecution,
  appendOutput,
} from "./executionHelpers.js";
import {
  commandHandleValidator,
  executionRecordValidator,
  executionLeaseValidator,
  logLeaseValidator,
  executionResultValidator,
  cachedLogPageValidator,
  providerLogPageValidator,
  EXECUTION_LEASE_MS,
  EXECUTION_LOG_BYTES,
  EXECUTION_LOG_CHUNKS,
} from "../execution.js";
import { providerErrorCodeValidator } from "../capabilities.js";

export const reserve = mutation({
  args: {
    ...commandHandleValidator.fields,
    expectedVersion: v.number(),
    idempotency: v.union(v.literal("native"), v.literal("none")),
  },
  returns: executionRecordValidator,
  handler: async (
    ctx,
    { sandbox, operationId, expectedVersion, idempotency },
  ) => {
    const operation = await beginOperation(ctx, {
      sandbox,
      operationId,
      expectedVersion,
      kind: "execute",
    });
    const existing = await findExecution(ctx, { sandbox, operationId });
    if (existing) return executionRecord(existing);
    if (operation.status !== "pending")
      throw new Error("Execution reservation is not pending");
    const now = Date.now();
    const row = {
      ...sandbox,
      operationId,
      reference: operation.reference,
      generation: operation.generation,
      version: 1,
      state: "queued" as const,
      idempotency,
      cancellation: { requested: false, acknowledgement: "none" as const },
      outputBytes: 0,
      outputTruncated: false,
      createdAt: now,
      updatedAt: now,
      statusVersion: 0,
      statusLeaseUntil: 0,
      cancelVersion: 0,
      cancelLeaseUntil: 0,
      cancelDispatched: false,
      logVersion: 0,
      logLeaseUntil: 0,
      providerCursor: null,
      logsComplete: false,
      chunkCount: 0,
    };
    const id = await ctx.db.insert("executions", row);
    const inserted = await ctx.db.get("executions", id);
    if (!inserted) throw new Error("Execution missing");
    return executionRecord(inserted);
  },
});
export const get = query({
  args: commandHandleValidator.fields,
  returns: v.union(v.null(), executionRecordValidator),
  handler: async (ctx, handle) => {
    const row = await findExecution(ctx, handle);
    return row ? executionRecord(row) : null;
  },
});
export const claim = mutation({
  args: {
    ...commandHandleValidator.fields,
    mode: v.union(v.literal("start"), v.literal("status")),
  },
  returns: v.union(v.null(), executionLeaseValidator),
  handler: async (ctx, { sandbox, operationId, mode }) => {
    const row = await findExecution(ctx, { sandbox, operationId });
    if (
      !row ||
      terminalExecution(row.state) ||
      row.statusLeaseUntil > Date.now()
    )
      return null;
    const machine = await mustSandbox(ctx, sandbox);
    const op = await ctx.db
      .query("operations")
      .withIndex("by_scope_and_key_and_operationId", (q) =>
        q
          .eq("scope", sandbox.scope)
          .eq("key", sandbox.key)
          .eq("operationId", operationId),
      )
      .unique();
    if (
      !op ||
      machine.generation !== row.generation ||
      machine.activeOperationId !== operationId
    )
      return null;
    if (mode === "start" ? op.status !== "pending" : op.status === "pending")
      return null;
    const patch = {
      statusVersion: row.statusVersion + 1,
      statusLeaseUntil: Date.now() + EXECUTION_LEASE_MS,
      version: row.version + 1,
      updatedAt: Date.now(),
    };
    await ctx.db.patch(row._id, patch);
    if (mode === "start") {
      await ctx.db.patch(op._id, {
        status: "running",
        leaseUntil: patch.statusLeaseUntil,
        version: op.version + 1,
        updatedAt: Date.now(),
      });
      await ctx.db.patch(machine._id, {
        version: machine.version + 1,
        refreshSequence: machine.refreshSequence + 1,
        refresh: { status: "stale" },
        updatedAt: Date.now(),
      });
    }
    return {
      record: executionRecord({ ...row, ...patch }),
      token: patch.statusVersion,
    };
  },
});
export const publish = mutation({
  args: {
    ...commandHandleValidator.fields,
    token: v.number(),
    result: executionResultValidator,
  },
  returns: v.boolean(),
  handler: async (ctx, { sandbox, operationId, token, result }) => {
    integer(token);
    const row = await findExecution(ctx, { sandbox, operationId });
    if (
      !row ||
      terminalExecution(row.state) ||
      row.statusVersion !== token ||
      row.statusLeaseUntil <= Date.now()
    )
      return false;
    const machine = await mustSandbox(ctx, sandbox);
    if (
      machine.generation !== row.generation ||
      machine.activeOperationId !== operationId
    )
      return false;
    let state = row.state,
      executionId = row.executionId,
      exitCode = row.exitCode,
      errorCode = row.errorCode;
    let output = {
      outputBytes: row.outputBytes,
      chunkCount: row.chunkCount,
      outputTruncated: row.outputTruncated,
    };
    let logsComplete = row.logsComplete;
    let inlineOutput = false;
    if ("snapshot" in result) {
      const snapshot = result.snapshot;
      if (
        !snapshot.executionId ||
        snapshot.executionId.length > 1024 ||
        (executionId && executionId !== snapshot.executionId) ||
        (snapshot.exitCode !== undefined &&
          !Number.isSafeInteger(snapshot.exitCode)) ||
        (snapshot.state === "completed" && snapshot.exitCode === undefined)
      )
        throw new Error("Invalid execution snapshot");
      // A queued status cannot move a known running process backwards.
      state =
        row.state === "running" && snapshot.state === "queued"
          ? "running"
          : snapshot.state;
      executionId = snapshot.executionId;
      exitCode = snapshot.exitCode;
      errorCode = undefined;
      if (
        snapshot.output &&
        terminalExecution(state) &&
        row.chunkCount === 0 &&
        row.providerCursor === null
      ) {
        output = await appendOutput(ctx, row, [
          { stream: "stdout", text: snapshot.output.stdout },
          { stream: "stderr", text: snapshot.output.stderr },
        ]);
        output.outputTruncated ||= snapshot.output.truncated;
        logsComplete = true;
        inlineOutput = true;
      }
    } else {
      state = result.notStarted && !executionId ? "failed" : "unknown";
      errorCode = result.errorCode;
    }
    await ctx.db.patch(row._id, {
      state,
      executionId,
      exitCode,
      errorCode,
      ...output,
      logsComplete,
      ...(inlineOutput
        ? { logVersion: row.logVersion + 1, logLeaseUntil: 0 }
        : {}),
      statusLeaseUntil: 0,
      version: row.version + 1,
      updatedAt: Date.now(),
    });
    const op = await ctx.db
      .query("operations")
      .withIndex("by_scope_and_key_and_operationId", (q) =>
        q
          .eq("scope", sandbox.scope)
          .eq("key", sandbox.key)
          .eq("operationId", operationId),
      )
      .unique();
    if (!op) throw new Error("Operation missing");
    const status =
      state === "completed"
        ? exitCode === 0
          ? "succeeded"
          : "failed"
        : state === "failed"
          ? "failed"
          : state === "cancelled"
            ? "cancelled"
            : state === "unknown" || op.status === "unknown"
              ? "unknown"
              : "running";
    await ctx.db.patch(op._id, {
      status,
      executionId,
      errorCode,
      leaseUntil: 0,
      version: op.version + 1,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(machine._id, {
      activeOperationId: terminalExecution(state) ? undefined : operationId,
      version: machine.version + 1,
      updatedAt: Date.now(),
    });
    return true;
  },
});
export const requestCancel = mutation({
  args: commandHandleValidator.fields,
  returns: v.union(v.null(), executionLeaseValidator),
  handler: async (ctx, handle) => {
    const row = await findExecution(ctx, handle);
    if (!row || terminalExecution(row.state)) return null;
    const machine = await mustSandbox(ctx, handle.sandbox);
    if (machine.generation !== row.generation) return null;
    if (row.cancelDispatched) {
      if (
        row.cancellation.acknowledgement === "pending" &&
        row.cancelLeaseUntil <= Date.now()
      )
        await ctx.db.patch(row._id, {
          cancellation: { requested: true, acknowledgement: "unknown" },
          version: row.version + 1,
          updatedAt: Date.now(),
        });
      return null;
    }
    const cancellation = {
      requested: true,
      acknowledgement: row.executionId
        ? ("pending" as const)
        : ("unknown" as const),
    };
    const patch = {
      cancellation,
      cancelVersion: row.cancelVersion + 1,
      cancelLeaseUntil: row.executionId ? Date.now() + EXECUTION_LEASE_MS : 0,
      cancelDispatched: !!row.executionId,
      version: row.version + 1,
      updatedAt: Date.now(),
    };
    await ctx.db.patch(row._id, patch);
    return row.executionId
      ? {
          record: executionRecord({ ...row, ...patch }),
          token: patch.cancelVersion,
        }
      : null;
  },
});
export const acknowledgeCancel = mutation({
  args: {
    ...commandHandleValidator.fields,
    token: v.number(),
    acknowledgement: v.union(
      v.literal("accepted"),
      v.literal("rejected"),
      v.literal("unknown"),
    ),
  },
  returns: v.boolean(),
  handler: async (ctx, { token, acknowledgement, ...handle }) => {
    const row = await findExecution(ctx, handle);
    if (
      !row?.cancelDispatched ||
      row.cancelVersion !== token ||
      row.cancelLeaseUntil <= Date.now()
    )
      return false;
    await ctx.db.patch(row._id, {
      cancellation: { requested: true, acknowledgement },
      cancelLeaseUntil: 0,
      version: row.version + 1,
      updatedAt: Date.now(),
    });
    return true;
  },
});
export const claimLogs = mutation({
  args: commandHandleValidator.fields,
  returns: v.union(v.null(), logLeaseValidator),
  handler: async (ctx, handle) => {
    const row = await findExecution(ctx, handle);
    if (!row?.executionId || row.logsComplete || row.logLeaseUntil > Date.now())
      return null;
    const machine = await mustSandbox(ctx, handle.sandbox);
    if (machine.generation !== row.generation) return null;
    if (
      row.outputBytes >= EXECUTION_LOG_BYTES ||
      row.chunkCount >= EXECUTION_LOG_CHUNKS
    ) {
      await ctx.db.patch(row._id, {
        outputTruncated: true,
        logsComplete: true,
      });
      return null;
    }
    const token = row.logVersion + 1;
    await ctx.db.patch(row._id, {
      logVersion: token,
      logLeaseUntil: Date.now() + EXECUTION_LEASE_MS,
    });
    return { record: executionRecord(row), token, cursor: row.providerCursor };
  },
});
export const appendLogs = mutation({
  args: {
    ...commandHandleValidator.fields,
    token: v.number(),
    page: v.optional(providerLogPageValidator),
    errorCode: v.optional(providerErrorCodeValidator),
  },
  returns: v.boolean(),
  handler: async (ctx, { token, page, errorCode, ...handle }) => {
    const row = await findExecution(ctx, handle);
    if (
      !row ||
      row.logsComplete ||
      row.logVersion !== token ||
      row.logLeaseUntil <= Date.now()
    )
      return false;
    const machine = await mustSandbox(ctx, handle.sandbox);
    if (machine.generation !== row.generation) return false;
    if (page && errorCode) throw new Error("Ambiguous log result");
    if (page) {
      if (
        (page.nextCursor?.length ?? 0) > 2048 ||
        (page.entries.length &&
          !page.complete &&
          page.nextCursor === row.providerCursor)
      )
        throw new Error("Invalid log cursor");
      const output = await appendOutput(ctx, row, page.entries);
      const atLimit =
        output.outputBytes >= EXECUTION_LOG_BYTES ||
        output.chunkCount >= EXECUTION_LOG_CHUNKS;
      output.outputTruncated ||=
        page.truncated === true || (!page.complete && atLimit);
      await ctx.db.patch(row._id, {
        ...output,
        providerCursor: page.nextCursor,
        logsComplete: page.complete || atLimit,
        logErrorCode: undefined,
        logLeaseUntil: 0,
        version: row.version + 1,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.patch(row._id, {
        logErrorCode: errorCode ?? "unknown_outcome",
        logLeaseUntil: 0,
        version: row.version + 1,
        updatedAt: Date.now(),
      });
    }
    return true;
  },
});
export const logs = query({
  args: {
    ...commandHandleValidator.fields,
    cursor: v.union(v.number(), v.null()),
    limit: v.number(),
  },
  returns: cachedLogPageValidator,
  handler: async (ctx, { cursor, limit, ...handle }) => {
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 16 ||
      (cursor !== null && (!Number.isSafeInteger(cursor) || cursor < 0))
    )
      throw new Error("Invalid log pagination");
    const row = await findExecution(ctx, handle);
    if (!row)
      return {
        entries: [],
        nextCursor: cursor,
        isDone: true,
        truncated: false,
      };
    const chunks = await ctx.db
      .query("executionLogs")
      .withIndex("by_scope_and_key_and_operationId_and_sequence", (q) =>
        q
          .eq("scope", handle.sandbox.scope)
          .eq("key", handle.sandbox.key)
          .eq("operationId", handle.operationId)
          .gt("sequence", cursor ?? -1),
      )
      .take(limit + 1);
    const entries = chunks.slice(0, limit).map((chunk) => ({
      sequence: chunk.sequence,
      stream: chunk.stream,
      text: chunk.text,
    }));
    return {
      entries,
      nextCursor: entries.at(-1)?.sequence ?? cursor,
      isDone: chunks.length <= limit,
      truncated: row.outputTruncated,
    };
  },
});
