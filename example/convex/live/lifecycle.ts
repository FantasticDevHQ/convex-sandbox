import {
  action,
  query,
  internalMutation,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { api, internal, components } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { v } from "convex/values";
import {
  createLifecycleStore,
  createFileStore,
  registryRecordValidator,
  operationRecordValidator,
  type RegistryRecord,
  type OperationRecord,
} from "@fantastic.dev/convex-sandbox";
import { requireOperator } from "./operator";
import { ownedBoatClient as client } from "./boatHost";
import { refuse } from "./allowanceModel";
import { fixtureValidator } from "./lifecycleModel";
const keyArgs = { key: v.string() };
const viewValidator = v.object({
  row: v.union(registryRecordValidator, v.null()),
  operation: v.union(operationRecordValidator, v.null()),
  fixture: v.union(fixtureValidator, v.null()),
  unresolvedStartIntent: v.optional(v.string()),
});
export type LifecycleView = {
  row: RegistryRecord | null;
  operation: OperationRecord | null;
  fixture: Doc<"liveFixtures"> | null;
  unresolvedStartIntent?: string;
};
async function fixtureFor(
  ctx: Pick<QueryCtx, "db">,
  scope: string,
  key: string,
) {
  return ctx.db
    .query("liveFixtures")
    .withIndex("by_scope_and_key", (q) => q.eq("scope", scope).eq("key", key))
    .unique();
}
export const status = query({
  args: keyArgs,
  returns: viewValidator,
  handler: async (ctx, { key }): Promise<LifecycleView> => {
    const operator = await requireOperator(ctx);
    const sandbox = { scope: operator.scope, key };
    const row = await ctx.runQuery(components.sandbox.registry.get, {
      sandbox,
    });
    if (row?.reference.provider !== "boat")
      return { row: null, operation: null, fixture: null };
    const fixture = await fixtureFor(ctx, operator.scope, key);
    const page = await ctx.runQuery(components.sandbox.operations.list, {
      sandbox,
      paginationOpts: { cursor: null, numItems: 5 },
    });
    const operation = row.activeOperationId
      ? await ctx.runQuery(components.sandbox.operations.get, {
          sandbox,
          operationId: row.activeOperationId,
        })
      : (page.page.find((op) => ["start", "stop"].includes(op.kind)) ?? null);
    const reservations = await ctx.db
      .query("liveReservations")
      .withIndex("by_scope_and_machineKey_and_kind", (q) =>
        q.eq("scope", operator.scope).eq("machineKey", key).eq("kind", "start"),
      )
      .take(5);
    let unresolvedStartIntent: string | undefined;
    for (const reservation of reservations) {
      if (reservation.status === "released") continue;
      const existing = await ctx.runQuery(components.sandbox.operations.get, {
        sandbox,
        operationId: reservation.intentKey,
      });
      if (!existing) {
        unresolvedStartIntent = reservation.intentKey;
        break;
      }
    }
    return {
      row,
      operation,
      fixture,
      ...(unresolvedStartIntent ? { unresolvedStartIntent } : {}),
    };
  },
});
async function matching(
  ctx: Pick<MutationCtx, "auth" | "db" | "runQuery">,
  key: string,
) {
  const operator = await requireOperator(ctx);
  const sandbox = { scope: operator.scope, key };
  const row = await ctx.runQuery(components.sandbox.registry.get, { sandbox });
  const fixture = await fixtureFor(ctx, operator.scope, key);
  if (
    row?.reference.provider !== "boat" ||
    row.tombstone ||
    !fixture ||
    fixture.generation !== row.generation ||
    fixture.providerId !== row.reference.providerId
  )
    refuse("The fixture no longer matches the owned binding.");
  return { row, fixture };
}
export const beginFixture = internalMutation({
  args: keyArgs,
  returns: fixtureValidator,
  handler: async (ctx, { key }) => {
    const operator = await requireOperator(ctx);
    const row = await ctx.runQuery(components.sandbox.registry.get, {
      sandbox: { scope: operator.scope, key },
    });
    if (
      !row ||
      row.tombstone ||
      row.reference.provider !== "boat" ||
      row.observedState !== "running" ||
      row.activeOperationId
    )
      refuse("Observe the owned machine running before preparing its fixture.");
    const existing = await fixtureFor(ctx, operator.scope, key);
    if (existing) {
      await matching(ctx, key);
      return existing;
    }
    const id = await ctx.db.insert("liveFixtures", {
      scope: operator.scope,
      key,
      providerId: row.reference.providerId,
      generation: row.generation,
      path: "",
      expectedText: `convex-sandbox persistence\n${key}\ngeneration=${row.generation}\n`,
      status: "preparing",
    });
    await ctx.db.patch(id, { path: `/home/user/.convex-sandbox-${id}.txt` });
    const created = await ctx.db.get(id);
    if (!created) throw Error("Fixture missing");
    return created;
  },
});
export const checkpoint = internalMutation({
  args: {
    key: v.string(),
    status: v.union(
      v.literal("written"),
      v.literal("awaiting_resume"),
      v.literal("verified"),
      v.literal("mismatch"),
    ),
    operationId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { row, fixture } = await matching(ctx, args.key);
    if (args.status === "verified") {
      const operation = await ctx.runQuery(components.sandbox.operations.get, {
        sandbox: { scope: row.scope, key: row.key },
        operationId: fixture.resumeOperationId ?? "",
      });
      if (
        row.observedState !== "running" ||
        !operation ||
        operation.kind !== "start" ||
        operation.status !== "succeeded" ||
        operation.generation !== row.generation ||
        operation.reference.provider !== "boat" ||
        operation.reference.providerId !== row.reference.providerId
      )
        refuse("Resume readiness is not confirmed.");
    }
    await ctx.db.patch(fixture._id, {
      status: args.status,
      ...(args.status === "written" ? { writtenAt: Date.now() } : {}),
      ...(args.operationId ? { resumeOperationId: args.operationId } : {}),
    });
    return null;
  },
});
async function fixtureFiles(
  ctx: ActionCtx,
  c: Awaited<ReturnType<typeof client>>,
  fixture: Doc<"liveFixtures">,
) {
  return c.providers.files({
    ...createFileStore(ctx, components.sandbox),
    getSandbox: async (sandbox) => {
      const row = await ctx.runQuery(components.sandbox.registry.get, {
        sandbox,
      });
      return row?.generation === fixture.generation &&
        row.reference.providerId === fixture.providerId
        ? row
        : null;
    },
    authorizePath: ({ path, reference, maxBytes }) =>
      path === fixture.path &&
      reference.provider === "boat" &&
      reference.providerId === fixture.providerId &&
      (maxBytes ?? 0) <= 512,
  });
}
async function bytesMatch(
  ctx: ActionCtx,
  c: Awaited<ReturnType<typeof client>>,
  fixture: Doc<"liveFixtures">,
) {
  const files = await fixtureFiles(ctx, c, fixture);
  const result = await files.readText({
    sandbox: c.sandbox,
    path: fixture.path,
    offset: 0,
    maxBytes: 512,
  });
  return (
    !result.truncated &&
    result.text === fixture.expectedText &&
    result.bytesRead ===
      new TextEncoder().encode(fixture.expectedText).byteLength
  );
}
export const prepareFixture = action({
  args: keyArgs,
  returns: viewValidator,
  handler: async (ctx, { key }): Promise<LifecycleView> => {
    const c = await client(ctx, key, "writeFile", true);
    const fixture = await ctx.runMutation(
      internal.live.lifecycle.beginFixture,
      { key },
    );
    if (!fixture.writtenAt) {
      const files = await fixtureFiles(ctx, c, fixture);
      await files.writeText({
        sandbox: c.sandbox,
        path: fixture.path,
        text: fixture.expectedText,
        operationId: `fixture-${fixture._id}`,
      });
      const matched = await bytesMatch(ctx, c, fixture);
      await ctx.runMutation(internal.live.lifecycle.checkpoint, {
        key,
        status: matched ? "written" : "mismatch",
      });
    }
    return ctx.runQuery(api.live.lifecycle.status, { key });
  },
});
export const run = action({
  args: {
    key: v.string(),
    action: v.union(v.literal("stop"), v.literal("start")),
    operationId: v.string(),
  },
  returns: viewValidator,
  handler: async (ctx, args): Promise<LifecycleView> => {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(args.operationId))
      refuse("Invalid operation identity.");
    const c = await client(ctx, args.key, args.action, args.action === "start");
    const operationId = `${args.action}-${args.operationId}`;
    const store = createLifecycleStore(ctx, components.sandbox);
    if (await store.getOperation(c.sandbox, operationId))
      return ctx.runQuery(api.live.lifecycle.status, { key: args.key });
    const row = await store.get(c.sandbox);
    if (
      !row ||
      row.tombstone ||
      row.activeOperationId ||
      row.observedState !== (args.action === "stop" ? "running" : "stopped")
    )
      refuse("Observe a stable owned machine state before this operation.");
    let reservationId: Doc<"liveReservations">["_id"] | undefined;
    if (args.action === "start") {
      const view = await ctx.runQuery(api.live.lifecycle.status, {
        key: args.key,
      });
      if (view.unresolvedStartIntent) return view;
      if (
        !view.fixture?.writtenAt ||
        view.fixture.generation !== row.generation ||
        view.fixture.providerId !== row.reference.providerId
      )
        refuse("Prepare and verify the original home fixture before resume.");
      const admission = await ctx.runMutation(internal.live.allowance.reserve, {
        runId: c.plan.runId,
        intentKey: operationId,
        machineKey: args.key,
        kind: "start",
      });
      if (!admission.admitted)
        return ctx.runQuery(api.live.lifecycle.status, { key: args.key });
      reservationId = admission.reservationId;
      await ctx.runMutation(internal.live.lifecycle.checkpoint, {
        key: args.key,
        status: "awaiting_resume",
        operationId,
      });
    }
    try {
      const result = await c.providers
        .lifecycle(store)
        .run({ sandbox: c.sandbox, operationId, action: args.action });
      if (reservationId && result?.status === "unknown")
        await ctx.runMutation(internal.live.allowance.markUnknown, {
          reservationId,
        });
    } catch {
      if (reservationId)
        await ctx.runMutation(internal.live.allowance.markUnknown, {
          reservationId,
        });
      else
        throw Error(
          "Stop was not confirmed. Inspect the original operation before retry.",
        );
    }
    return ctx.runQuery(api.live.lifecycle.status, { key: args.key });
  },
});
export const inspect = action({
  args: keyArgs,
  returns: viewValidator,
  handler: async (ctx, { key }): Promise<LifecycleView> => {
    const c = await client(ctx, key, "describe");
    let view = await ctx.runQuery(api.live.lifecycle.status, { key });
    if (view.operation)
      await c.providers
        .lifecycle(createLifecycleStore(ctx, components.sandbox))
        .reconcile({
          sandbox: c.sandbox,
          operationId: view.operation.operationId,
          policy: { maxAttempts: 1, maxElapsedMs: 5000, callTimeoutMs: 5000 },
        });
    view = await ctx.runQuery(api.live.lifecycle.status, { key });
    if (
      view.operation?.kind === "stop" &&
      view.operation.status === "succeeded" &&
      view.row?.observedState === "stopped"
    )
      await ctx.runMutation(internal.live.allowance.releaseStopped, {
        key,
        operationId: view.operation.operationId,
      });
    if (
      view.operation?.kind === "start" &&
      view.operation.status === "succeeded" &&
      view.row?.observedState === "running" &&
      view.fixture?.resumeOperationId === view.operation.operationId
    ) {
      const matched = await bytesMatch(ctx, c, view.fixture);
      await ctx.runMutation(internal.live.lifecycle.checkpoint, {
        key,
        status: matched ? "verified" : "mismatch",
      });
    }
    return ctx.runQuery(api.live.lifecycle.status, { key });
  },
});
