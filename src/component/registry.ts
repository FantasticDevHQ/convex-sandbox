import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import {
  sandboxKeyValidator,
  providerReferenceValidator,
  sandboxStateValidator,
  machineResourcesValidator,
} from "../contracts.js";
import { providerErrorCodeValidator } from "../capabilities.js";
import {
  registryRecordValidator,
  registryPageValidator,
  refreshTicketValidator,
} from "../state.js";
import {
  boundedString,
  findSandbox,
  mustSandbox,
  registryRecord,
  integer,
  pagination,
} from "./stateHelpers.js";

/** Host wrappers authenticate and resolve scope/reference before calling component functions. */
export const ensure = mutation({
  args: { sandbox: sandboxKeyValidator, reference: providerReferenceValidator },
  returns: registryRecordValidator,
  handler: async (ctx, { sandbox, reference }) => {
    boundedString(reference.provider, 256);
    boundedString(reference.providerId);
    const existing = await findSandbox(ctx, sandbox);
    if (existing) {
      if (
        existing.reference.provider !== reference.provider ||
        existing.reference.providerId !== reference.providerId
      )
        throw new Error("Reference conflict");
      return registryRecord(existing);
    }
    const claim = await ctx.db
      .query("provisions")
      .withIndex("by_scope_and_key", (q) =>
        q.eq("scope", sandbox.scope).eq("key", sandbox.key),
      )
      .unique();
    if (claim && claim.status !== "failed") throw new Error("Provision active");
    const value = {
      ...sandbox,
      reference,
      generation: 1,
      version: 1,
      observedState: "unknown" as const,
      tombstone: false,
      refreshSequence: 0,
      observedSequence: 0,
      refresh: { status: "never" as const },
      updatedAt: Date.now(),
      operationCount: 0,
      nextSequence: 0,
    };
    await ctx.db.insert("sandboxes", value);
    const {
      operationCount: _count,
      nextSequence: _sequence,
      ...record
    } = value;
    return record;
  },
});
export const get = query({
  args: { sandbox: sandboxKeyValidator },
  returns: v.union(v.null(), registryRecordValidator),
  handler: async (ctx, { sandbox }) => {
    const row = await findSandbox(ctx, sandbox);
    return row ? registryRecord(row) : null;
  },
});
export const list = query({
  args: { scope: v.string(), paginationOpts: paginationOptsValidator },
  returns: registryPageValidator,
  handler: async (ctx, { scope, paginationOpts }) => {
    boundedString(scope);
    const result = await ctx.db
      .query("sandboxes")
      .withIndex("by_scope_and_key", (q) => q.eq("scope", scope))
      .paginate(pagination(paginationOpts));
    return {
      page: result.page.map(registryRecord),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});
export const rebind = mutation({
  args: {
    sandbox: sandboxKeyValidator,
    expectedVersion: v.number(),
    reference: providerReferenceValidator,
  },
  returns: registryRecordValidator,
  handler: async (ctx, { sandbox, expectedVersion, reference }) => {
    integer(expectedVersion);
    boundedString(reference.provider, 256);
    boundedString(reference.providerId);
    const row = await mustSandbox(ctx, sandbox);
    if (row.version !== expectedVersion) throw new Error("Version conflict");
    if (!row.tombstone || row.activeOperationId)
      throw new Error("Rebind requires resolved deletion");
    await ctx.db.patch(row._id, {
      reference,
      generation: row.generation + 1,
      version: row.version + 1,
      requestedState: undefined,
      observedState: "unknown",
      resources: undefined,
      tombstone: false,
      refreshSequence: 0,
      observedSequence: 0,
      refresh: { status: "never" },
      observedAt: undefined,
      updatedAt: Date.now(),
    });
    return registryRecord(await mustSandbox(ctx, sandbox));
  },
});
export const beginRefresh = mutation({
  args: { sandbox: sandboxKeyValidator },
  returns: refreshTicketValidator,
  handler: async (ctx, { sandbox }) => {
    const row = await mustSandbox(ctx, sandbox);
    if (row.tombstone) throw new Error("Sandbox deleted");
    const sequence = row.refreshSequence + 1;
    await ctx.db.patch(row._id, {
      refreshSequence: sequence,
      version: row.version + 1,
      refresh: { status: "pending" },
      updatedAt: Date.now(),
    });
    return { generation: row.generation, sequence };
  },
});
export const finishRefresh = mutation({
  args: {
    sandbox: sandboxKeyValidator,
    ...refreshTicketValidator.fields,
    result: v.union(
      v.object({
        state: sandboxStateValidator,
        resources: v.optional(machineResourcesValidator),
      }),
      v.object({ errorCode: providerErrorCodeValidator }),
    ),
  },
  returns: v.boolean(),
  handler: async (ctx, { sandbox, generation, sequence, result }) => {
    integer(generation);
    integer(sequence);
    const row = await mustSandbox(ctx, sandbox);
    if (
      row.generation !== generation ||
      row.refreshSequence !== sequence ||
      row.refresh.status !== "pending" ||
      row.tombstone
    )
      return false;
    if ("errorCode" in result) {
      await ctx.db.patch(row._id, {
        refresh: { status: "failed", errorCode: result.errorCode },
        version: row.version + 1,
        updatedAt: Date.now(),
      });
    } else {
      if (
        result.resources &&
        Object.values(result.resources).some(
          (value) =>
            value !== undefined && (!Number.isFinite(value) || value <= 0),
        )
      )
        throw new Error("Invalid resources");
      await ctx.db.patch(row._id, {
        observedState: result.state,
        resources: result.resources,
        observedSequence: sequence,
        tombstone: result.state === "deleted",
        refresh: { status: "fresh" },
        observedAt: Date.now(),
        updatedAt: Date.now(),
        version: row.version + 1,
      });
    }
    return true;
  },
});
