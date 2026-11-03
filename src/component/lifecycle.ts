import { v, type Infer } from "convex/values";
import type { providerErrorCodeValidator } from "../capabilities.js";
import { mutation, query, type QueryCtx } from "./_generated/server.js";
import { sandboxKeyValidator } from "../contracts.js";
import {
  completionValidator,
  createAdmissionValidator,
  provisionRecordValidator,
  LIFECYCLE_LEASE_MS,
} from "../lifecycle.js";
import { operationRecordValidator } from "../state.js";
import {
  boundedString,
  validateIdentity,
  findSandbox,
  mustSandbox,
  registryRecord,
  operationRecord,
  integer,
} from "./stateHelpers.js";
import type { SandboxKey } from "../contracts.js";
import type { Doc } from "./_generated/dataModel.js";

async function provision(ctx: Pick<QueryCtx, "db">, sandbox: SandboxKey) {
  validateIdentity(sandbox);
  return ctx.db
    .query("provisions")
    .withIndex("by_scope_and_key", (q) =>
      q.eq("scope", sandbox.scope).eq("key", sandbox.key),
    )
    .unique();
}
function project(row: Doc<"provisions">) {
  const { _id, _creationTime: _time, ...value } = row;
  return value;
}
const done = (status: string) =>
  status === "succeeded" || status === "failed" || status === "cancelled";
export const reserveCreate = mutation({
  args: {
    sandbox: sandboxKeyValidator,
    provider: v.string(),
    operationId: v.string(),
    idempotency: v.union(v.literal("native"), v.literal("none")),
  },
  returns: createAdmissionValidator,
  handler: async (ctx, { sandbox, provider, operationId, idempotency }) => {
    boundedString(provider, 256);
    boundedString(operationId, 256);
    const bound = await findSandbox(ctx, sandbox);
    if (bound) {
      if (bound.reference.provider !== provider)
        throw new Error("Reference conflict");
      return { kind: "bound" as const, registry: registryRecord(bound) };
    }
    const prior = await provision(ctx, sandbox);
    if (prior) {
      if (prior.operationId === operationId && prior.provider === provider)
        return {
          kind: "provision" as const,
          admitted: false,
          provision: project(prior),
        };
      if (prior.status !== "failed") throw new Error("Provision active");
    }
    const now = Date.now();
    const value = {
      ...sandbox,
      provider,
      operationId,
      idempotency,
      status: "running" as const,
      version: (prior?.version ?? 0) + 1,
      leaseUntil: now + LIFECYCLE_LEASE_MS,
      createdAt: now,
      updatedAt: now,
    };
    if (prior) await ctx.db.replace(prior._id, value);
    else await ctx.db.insert("provisions", value);
    return { kind: "provision" as const, admitted: true, provision: value };
  },
});
export const getProvision = query({
  args: { sandbox: sandboxKeyValidator },
  returns: v.union(v.null(), provisionRecordValidator),
  handler: async (ctx, { sandbox }) => {
    const row = await provision(ctx, sandbox);
    return row ? project(row) : null;
  },
});
export const claimCreateReconciliation = mutation({
  args: { sandbox: sandboxKeyValidator, operationId: v.string() },
  returns: v.union(v.null(), provisionRecordValidator),
  handler: async (ctx, { sandbox, operationId }) => {
    const row = await provision(ctx, sandbox);
    if (
      !row ||
      row.operationId !== operationId ||
      done(row.status) ||
      row.leaseUntil > Date.now()
    )
      return null;
    const patch = {
      status: "unknown" as const,
      version: row.version + 1,
      leaseUntil: Date.now() + LIFECYCLE_LEASE_MS,
      updatedAt: Date.now(),
    };
    await ctx.db.patch(row._id, patch);
    return { ...project(row), ...patch };
  },
});
export const finishCreate = mutation({
  args: {
    sandbox: sandboxKeyValidator,
    operationId: v.string(),
    expectedVersion: v.number(),
    result: completionValidator,
  },
  returns: v.boolean(),
  handler: async (ctx, { sandbox, operationId, expectedVersion, result }) => {
    integer(expectedVersion);
    const row = await provision(ctx, sandbox);
    if (
      !row ||
      row.operationId !== operationId ||
      row.version !== expectedVersion ||
      done(row.status) ||
      row.leaseUntil <= Date.now()
    )
      return false;
    if ("errorCode" in result) {
      await ctx.db.patch(row._id, {
        status: result.notStarted ? "failed" : "unknown",
        errorCode: result.errorCode,
        version: row.version + 1,
        leaseUntil: 0,
        updatedAt: Date.now(),
      });
    } else {
      const description = result.description;
      boundedString(description.providerId);
      validateResources(description.resources);
      if (await findSandbox(ctx, sandbox))
        throw new Error("Reference conflict");
      const reference = {
        provider: row.provider,
        providerId: description.providerId,
      };
      await ctx.db.insert("sandboxes", {
        ...sandbox,
        reference,
        generation: 1,
        version: 1,
        observedState: description.state,
        resources: description.resources,
        tombstone: description.state === "deleted",
        refreshSequence: 1,
        observedSequence: 1,
        refresh: { status: "fresh" },
        observedAt: Date.now(),
        updatedAt: Date.now(),
        operationCount: 0,
        nextSequence: 0,
      });
      await ctx.db.patch(row._id, {
        reference,
        status: "succeeded",
        errorCode: undefined,
        version: row.version + 1,
        leaseUntil: 0,
        updatedAt: Date.now(),
      });
    }
    return true;
  },
});
export const claimOperation = mutation({
  args: {
    sandbox: sandboxKeyValidator,
    operationId: v.string(),
    expectedVersion: v.number(),
    mode: v.union(v.literal("execute"), v.literal("reconcile")),
  },
  returns: v.union(v.null(), operationRecordValidator),
  handler: async (ctx, { sandbox, operationId, expectedVersion, mode }) => {
    integer(expectedVersion);
    const row = await mustSandbox(ctx, sandbox);
    const op = await findOperation(ctx, sandbox, operationId);
    if (
      !op ||
      op.version !== expectedVersion ||
      op.generation !== row.generation ||
      row.activeOperationId !== operationId ||
      done(op.status)
    )
      return null;
    if (
      mode === "execute"
        ? op.status !== "pending"
        : op.status === "pending" || (op.leaseUntil ?? 0) > Date.now()
    )
      return null;
    const patch = {
      status: mode === "execute" ? ("running" as const) : ("unknown" as const),
      version: op.version + 1,
      leaseUntil: Date.now() + LIFECYCLE_LEASE_MS,
      observationSequence: row.refreshSequence + 1,
      updatedAt: Date.now(),
    };
    await ctx.db.patch(op._id, patch);
    await ctx.db.patch(row._id, {
      version: row.version + 1,
      updatedAt: Date.now(),
      ...(!row.tombstone
        ? {
            refreshSequence: row.refreshSequence + 1,
            refresh: { status: "stale" as const },
          }
        : {}),
    });
    return { ...operationRecord(op), ...patch };
  },
});
export const finishOperation = mutation({
  args: {
    sandbox: sandboxKeyValidator,
    operationId: v.string(),
    expectedVersion: v.number(),
    result: completionValidator,
  },
  returns: v.boolean(),
  handler: async (ctx, { sandbox, operationId, expectedVersion, result }) => {
    integer(expectedVersion);
    const row = await mustSandbox(ctx, sandbox);
    const op = await findOperation(ctx, sandbox, operationId);
    if (
      !op ||
      op.version !== expectedVersion ||
      op.generation !== row.generation ||
      row.activeOperationId !== operationId ||
      done(op.status) ||
      !op.leaseUntil ||
      op.leaseUntil <= Date.now()
    )
      return false;
    if (!["start", "resumeMemory", "stop", "delete"].includes(op.kind))
      throw new Error("Invalid lifecycle operation");
    if (
      "description" in result &&
      row.refreshSequence !== op.observationSequence
    ) {
      await ctx.db.patch(op._id, {
        status: "unknown",
        leaseUntil: 0,
        version: op.version + 1,
        updatedAt: Date.now(),
      });
      await ctx.db.patch(row._id, {
        version: row.version + 1,
        updatedAt: Date.now(),
      });
      return false;
    }
    let status: "succeeded" | "failed" | "unknown" = "unknown";
    let errorCode: Infer<typeof providerErrorCodeValidator> | undefined;
    if ("errorCode" in result) {
      status = result.notStarted ? "failed" : "unknown";
      errorCode = result.errorCode;
      if (!row.tombstone)
        await ctx.db.patch(row._id, {
          refreshSequence: row.refreshSequence + 1,
          refresh: { status: "stale" },
        });
    } else {
      const description = result.description;
      if (description.providerId !== row.reference.providerId)
        throw new Error("Reference conflict");
      validateResources(description.resources);
      if (row.tombstone && description.state !== "deleted") return false;
      const target =
        op.kind === "delete"
          ? description.state === "deleted"
          : op.kind === "stop"
            ? ["stopped", "paused"].includes(description.state)
            : description.state === "running";
      status = target
        ? "succeeded"
        : description.state === "deleted"
          ? "failed"
          : "unknown";
      await ctx.db.patch(row._id, {
        observedState: description.state,
        resources: description.resources,
        tombstone: description.state === "deleted",
        observedAt: Date.now(),
        refreshSequence: row.refreshSequence + 1,
        observedSequence: row.refreshSequence + 1,
        refresh: { status: "fresh" },
      });
    }
    await ctx.db.patch(op._id, {
      status,
      errorCode,
      leaseUntil: 0,
      version: op.version + 1,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(row._id, {
      activeOperationId: done(status) ? undefined : operationId,
      version: row.version + 1,
      updatedAt: Date.now(),
    });
    return true;
  },
});
async function findOperation(
  ctx: Pick<QueryCtx, "db">,
  sandbox: SandboxKey,
  operationId: string,
) {
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
function validateResources(
  resources:
    { cpuCount?: number; memoryMiB?: number; diskMiB?: number } | undefined,
) {
  if (
    resources &&
    Object.values(resources).some(
      (value) => value !== undefined && (!Number.isFinite(value) || value <= 0),
    )
  )
    throw new Error("Invalid resources");
}
