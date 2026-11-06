import { v } from "convex/values";
import { mutation, type QueryCtx } from "./_generated/server.js";
import { operationHandleValidator } from "../contracts.js";
import { operationRecordValidator } from "../state.js";
import {
  imageReferenceValidator,
  imageKindValidator,
  imageCompletionValidator,
} from "../images.js";
import {
  normalizeImage,
  normalizeImageSnapshot,
  nativeId,
} from "../imageProtocol.js";
import { beginOperation } from "./operations.js";
import {
  mustSandbox,
  operationRecord,
  integer,
  validateIdentity,
  boundedString,
} from "./stateHelpers.js";

async function find(
  ctx: Pick<QueryCtx, "db">,
  sandbox: { scope: string; key: string },
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
const terminal = (status: string) =>
  ["succeeded", "failed", "cancelled"].includes(status);

export const reserve = mutation({
  args: {
    ...operationHandleValidator.fields,
    expectedVersion: v.number(),
    kind: imageKindValidator,
    image: v.optional(imageReferenceValidator),
  },
  returns: operationRecordValidator,
  handler: async (ctx, args) => {
    const row = await mustSandbox(ctx, args.sandbox);
    const source = args.image
      ? normalizeImage(args.image, row.reference.provider)
      : undefined;
    if ((args.kind === "restore") !== (source !== undefined))
      throw new Error(
        "Restore requires an image; other operations do not accept one",
      );
    const op = await beginOperation(ctx, args);
    if (op.nativeImage) {
      if (JSON.stringify(op.nativeImage.source) !== JSON.stringify(source))
        throw new Error("Image operation identity conflict");
      return op;
    }
    if (op.status !== "pending")
      throw new Error("Image operation is not pending");
    const stored = await find(ctx, args.sandbox, args.operationId);
    if (!stored) throw new Error("Image operation missing");
    const nativeImage = source ? { source } : {};
    await ctx.db.patch(stored._id, { nativeImage });
    return { ...op, nativeImage };
  },
});
export const claim = mutation({
  args: {
    ...operationHandleValidator.fields,
    mode: v.union(v.literal("start"), v.literal("status")),
  },
  returns: v.union(v.null(), operationRecordValidator),
  handler: async (ctx, { sandbox, operationId, mode }) => {
    const row = await mustSandbox(ctx, sandbox),
      op = await find(ctx, sandbox, operationId);
    if (
      !op?.nativeImage ||
      terminal(op.status) ||
      (op.leaseUntil ?? 0) > Date.now() ||
      row.tombstone ||
      op.generation !== row.generation ||
      row.activeOperationId !== operationId ||
      (mode === "start" ? op.status !== "pending" : op.status === "pending")
    )
      return null;
    const patch = {
      nativeImage: { ...op.nativeImage, leaseMode: mode },
      status: "running" as const,
      leaseUntil: Date.now() + 30000,
      version: op.version + 1,
      updatedAt: Date.now(),
    };
    await ctx.db.patch(op._id, patch);
    return operationRecord({ ...op, ...patch });
  },
});
export const publish = mutation({
  args: {
    ...operationHandleValidator.fields,
    expectedVersion: v.number(),
    result: imageCompletionValidator,
  },
  returns: v.boolean(),
  handler: async (ctx, { sandbox, operationId, expectedVersion, result }) => {
    integer(expectedVersion);
    const row = await mustSandbox(ctx, sandbox),
      op = await find(ctx, sandbox, operationId);
    if (
      !op?.nativeImage ||
      terminal(op.status) ||
      op.version !== expectedVersion ||
      (op.leaseUntil ?? 0) <= Date.now() ||
      row.tombstone ||
      row.generation !== op.generation ||
      row.activeOperationId !== operationId
    )
      return false;
    if (!imageKindValidator.members.some((member) => member.value === op.kind))
      throw new Error("Invalid image operation kind");
    if (
      "notStarted" in result &&
      result.notStarted &&
      op.nativeImage.leaseMode !== "start"
    )
      throw new Error("Status cannot prove a mutation never started");
    const kind = op.kind as import("../images.js").ImageOperationKind;
    const state =
      "state" in result
        ? normalizeImageSnapshot(
            result,
            kind,
            op.reference.provider,
            op.nativeImage.providerOperationId,
          )
        : null;
    const accepted =
      state?.state === "pending" ? state.acceptedMachine : undefined;
    const readyMachine =
      state?.state === "ready" && "machine" in state.result
        ? state.result.machine
        : undefined;
    const retained = op.nativeImage.acceptedMachine;
    for (const machine of [accepted, readyMachine]) {
      if (
        machine &&
        (kind !== "fork" ||
          machine.providerId === op.reference.providerId ||
          (retained &&
            (machine.provider !== retained.provider ||
              machine.providerId !== retained.providerId)))
      )
        throw new Error("Fork child identity conflict");
    }
    const status = state
      ? state.state === "ready"
        ? "succeeded"
        : state.state === "failed"
          ? "failed"
          : "running"
      : "errorCode" in result && result.notStarted
        ? "failed"
        : "unknown";
    const { leaseMode: _leaseMode, ...metadata } = op.nativeImage;
    const nativeImage = {
      ...metadata,
      ...(accepted ? { acceptedMachine: accepted } : {}),
      ...(state?.state === "pending"
        ? { providerOperationId: nativeId(state.operationId) }
        : {}),
      ...(state?.state === "ready" ? { result: state.result } : {}),
    };
    await ctx.db.patch(op._id, {
      status,
      nativeImage,
      errorCode: "errorCode" in result ? result.errorCode : undefined,
      leaseUntil: 0,
      version: op.version + 1,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(row._id, {
      activeOperationId: terminal(status) ? undefined : operationId,
      version: row.version + 1,
      updatedAt: Date.now(),
    });
    return true;
  },
});
