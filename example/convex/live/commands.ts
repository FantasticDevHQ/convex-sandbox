import { query, action, type QueryCtx } from "../_generated/server";
import { api, components } from "../_generated/api";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  commandInputValidator,
  executionRecordValidator,
  operationPageValidator,
  createExecutionStore,
  type CommandInput,
  type ExecutionRecord,
} from "@fantastic.dev/convex-sandbox";
import { requireOperator } from "./operator";
import { ownedBoatClient } from "./boatHost";
import { refuse } from "./allowanceModel";
const handleArgs = { key: v.string(), operationId: v.string() };
function commandIdentity(id: string) {
  if (!/^command-[a-zA-Z0-9_-]{1,80}$/.test(id))
    refuse("Use a stable command operation identity.");
}
async function ownedRow(ctx: Pick<QueryCtx, "auth" | "runQuery">, key: string) {
  const operator = await requireOperator(ctx);
  const sandbox = { scope: operator.scope, key };
  const row = await ctx.runQuery(components.sandbox.registry.get, { sandbox });
  return { sandbox, row: row?.reference.provider === "boat" ? row : null };
}
export const get = query({
  args: handleArgs,
  returns: v.union(executionRecordValidator, v.null()),
  handler: async (ctx, args): Promise<ExecutionRecord | null> => {
    const { sandbox, row } = await ownedRow(ctx, args.key);
    commandIdentity(args.operationId);
    if (!row) return null;
    const execution = await ctx.runQuery(components.sandbox.execution.get, {
      sandbox,
      operationId: args.operationId,
    });
    return execution &&
      execution.generation === row.generation &&
      execution.reference.provider === "boat" &&
      execution.reference.providerId === row.reference.providerId
      ? execution
      : null;
  },
});
export const list = query({
  args: { key: v.string(), paginationOpts: paginationOptsValidator },
  returns: operationPageValidator,
  handler: async (ctx, { key, paginationOpts }) => {
    const { sandbox, row } = await ownedRow(ctx, key);
    if (
      !Number.isSafeInteger(paginationOpts.numItems) ||
      paginationOpts.numItems < 1 ||
      paginationOpts.numItems > 50
    )
      refuse("Request 1–50 command records per page.");
    if (!row) return { page: [], isDone: true, continueCursor: "" };
    const page = await ctx.runQuery(components.sandbox.operations.list, {
      sandbox,
      paginationOpts,
    });
    return {
      ...page,
      page: page.page.filter(
        (op) =>
          op.kind === "execute" &&
          op.generation === row.generation &&
          op.reference.provider === "boat" &&
          op.reference.providerId === row.reference.providerId,
      ),
    };
  },
});
function supported(input: CommandInput) {
  if (
    input.env !== undefined ||
    input.timeoutMs !== undefined ||
    (input.cwd !== undefined &&
      (input.cwd.startsWith("/") ||
        input.cwd.split("/").includes("..") ||
        input.cwd.length > 256))
  )
    refuse(
      "Per-command environment, runtime timeout and absolute/traversing cwd are unsupported.",
    );
  if (
    input.kind === "shell"
      ? input.command.length < 1 || input.command.length > 4096
      : input.executable.length < 1 ||
        input.executable.length > 256 ||
        input.executable.includes("=") ||
        input.args.length > 32 ||
        input.args.some((arg) => arg.length > 512)
  )
    refuse("Command exceeds the example input bounds.");
}
export const start = action({
  args: { ...handleArgs, input: commandInputValidator },
  returns: executionRecordValidator,
  handler: async (ctx, args): Promise<ExecutionRecord> => {
    await requireOperator(ctx);
    commandIdentity(args.operationId);
    supported(args.input);
    const existing = await ctx.runQuery(api.live.commands.get, {
      key: args.key,
      operationId: args.operationId,
    });
    if (existing) return existing;
    const c = await ownedBoatClient(ctx, args.key, "execute", true);
    const row = await ctx.runQuery(components.sandbox.registry.get, {
      sandbox: c.sandbox,
    });
    if (
      !row ||
      row.tombstone ||
      row.observedState !== "running" ||
      (row.activeOperationId && row.activeOperationId !== args.operationId)
    )
      refuse(
        "Observe an owned running machine without another unfinished operation.",
      );
    return c.providers
      .execution(createExecutionStore(ctx, components.sandbox))
      .start({
        sandbox: c.sandbox,
        operationId: args.operationId,
        input: args.input,
      });
  },
});
export const inspect = action({
  args: handleArgs,
  returns: v.union(executionRecordValidator, v.null()),
  handler: async (ctx, args): Promise<ExecutionRecord | null> => {
    await requireOperator(ctx);
    commandIdentity(args.operationId);
    const existing = await ctx.runQuery(api.live.commands.get, args);
    if (
      !existing ||
      ["completed", "failed", "cancelled"].includes(existing.state)
    )
      return existing;
    const c = await ownedBoatClient(ctx, args.key, "executionStatus");
    await c.providers
      .execution(createExecutionStore(ctx, components.sandbox))
      .status({ sandbox: c.sandbox, operationId: args.operationId }, 5000);
    return ctx.runQuery(api.live.commands.get, args);
  },
});
