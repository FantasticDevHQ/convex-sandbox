import { query, action, type ActionCtx } from "../_generated/server";
import { components } from "../_generated/api";
import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  createHostAccess,
  withSandboxErrors,
} from "@fantastic.dev/convex-sandbox/server";
import {
  createLifecycleStore,
  registryRecordValidator,
  SandboxProviders,
  SandboxProviderError,
} from "@fantastic.dev/convex-sandbox";
import { createBoatProvider } from "@fantastic.dev/convex-sandbox/boat";
import { requireOperator } from "./operator";

function accessFor(ctx: Pick<ActionCtx, "auth" | "runQuery">) {
  return createHostAccess({
    authenticate: () => requireOperator(ctx),
    getSandbox: (sandbox) =>
      ctx.runQuery(components.sandbox.registry.get, { sandbox }),
    listSandboxes: (scope, page) =>
      ctx.runQuery(components.sandbox.registry.list, {
        scope,
        paginationOpts: { cursor: page.cursor, numItems: page.limit },
      }),
    authorize: ({ principal, sandbox, reference, operation }) =>
      principal.scope === sandbox.scope &&
      reference?.provider === "boat" &&
      ["get", "list", "describe"].includes(operation),
  });
}

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(registryRecordValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
    partial: v.boolean(),
  }),
  handler: async (ctx, { paginationOpts }) => {
    await requireOperator(ctx);
    if (paginationOpts.numItems > 50)
      throw new ConvexError({
        code: "validation",
        message: "Request at most 50 machines per page.",
      });
    return withSandboxErrors(() =>
      accessFor(ctx).list({
        cursor: paginationOpts.cursor,
        limit: paginationOpts.numItems,
      }),
    );
  },
});

export const get = query({
  args: { key: v.string() },
  returns: v.union(v.null(), registryRecordValidator),
  handler: async (ctx, { key }) => {
    const principal = await requireOperator(ctx);
    return withSandboxErrors(async () => {
      const row = await ctx.runQuery(components.sandbox.registry.get, {
        sandbox: { scope: principal.scope, key },
      });
      if (row?.reference.provider !== "boat") return null;
      return accessFor(ctx).get({ key });
    });
  },
});

/** One bounded describe through the public shared lifecycle client, never an account scan. */
export const refresh = action({
  args: { key: v.string() },
  returns: registryRecordValidator,
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    return withSandboxErrors(async () => {
      const access = accessFor(ctx);
      const { sandbox } = await access.resolve(args, "describe");
      const apiKey = process.env.BOAT_API_KEY;
      if (!apiKey)
        throw new SandboxProviderError({
          code: "unsupported",
          capability: "describe",
          outcome: "not_started",
          retryable: false,
        });
      const providers = new SandboxProviders({ authorize: access.authorize });
      providers.register(
        createBoatProvider({ apiKey, org: process.env.BOAT_ORG ?? "personal" }),
      );
      await providers
        .lifecycle(createLifecycleStore(ctx, components.sandbox))
        .refresh(sandbox);
      // Reauthorize and project the accepted current binding after sequence/generation fencing.
      return access.get(args);
    });
  },
});
