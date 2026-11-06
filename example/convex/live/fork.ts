import { v, type Infer } from "convex/values";
import {
  action,
  query,
  internalMutation,
  type QueryCtx,
  type MutationCtx,
  type ActionCtx,
} from "../_generated/server";
import { api, internal, components } from "../_generated/api";
import {
  createImageStore,
  createFileStore,
  createLifecycleStore,
} from "@fantastic.dev/convex-sandbox";
import { createHostAccess } from "@fantastic.dev/convex-sandbox/server";
import { requireOperator } from "./operator";
import { refuse } from "./allowanceModel";
import { ownedBoatClient } from "./boatHost";
import { forkViewValidator } from "./forkModel";
export type ForkView = Infer<typeof forkViewValidator>;
const args = { sourceKey: v.string(), childKey: v.string() };
type Input = { sourceKey: string; childKey: string };
function identity(input: Input) {
  for (const key of [input.sourceKey, input.childKey])
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(key) || key === "new")
      refuse("Choose valid distinct machine keys.");
  if (input.sourceKey === input.childKey)
    refuse("The child must have a new logical key.");
  return `fork-${input.childKey}`;
}
async function read(
  ctx: Pick<QueryCtx, "auth" | "db" | "runQuery">,
  input: Input,
): Promise<ForkView> {
  identity(input);
  const operator = await requireOperator(ctx),
    sandbox = { scope: operator.scope, key: input.sourceKey };
  const found = await ctx.runQuery(components.sandbox.registry.get, {
    sandbox,
  });
  const source = found?.reference.provider === "boat" ? found : null;
  const intent = await ctx.db
    .query("liveForks")
    .withIndex("by_scope_and_childKey", (q) =>
      q.eq("scope", operator.scope).eq("childKey", input.childKey),
    )
    .unique();
  if (intent && intent.sourceKey !== input.sourceKey)
    refuse("This child intent belongs to its original source.");
  const fixture = await ctx.db
    .query("liveFixtures")
    .withIndex("by_scope_and_key", (q) =>
      q.eq("scope", operator.scope).eq("key", input.sourceKey),
    )
    .unique();
  const page = source
    ? await ctx.runQuery(components.sandbox.operations.list, {
        sandbox,
        paginationOpts: { cursor: null, numItems: 50 },
      })
    : null;
  const stop = page?.page.find(
    (op) =>
      op.kind === "stop" &&
      op.status === "succeeded" &&
      op.generation === source?.generation &&
      op.reference.providerId === source?.reference.providerId,
  );
  const operation = intent
    ? await ctx.runQuery(components.sandbox.operations.get, {
        sandbox,
        operationId: intent.operationId,
      })
    : null;
  const child = intent?.childId
    ? await ctx.runQuery(components.sandbox.registry.get, {
        sandbox: { scope: operator.scope, key: input.childKey },
      })
    : null;
  return {
    source,
    child,
    intent,
    operation,
    stopConfirmed: !!(
      source &&
      !source.tombstone &&
      source.observedState === "stopped" &&
      !source.activeOperationId &&
      stop &&
      !page?.page.some(
        (op) => op.kind === "start" && op.sequence > stop.sequence,
      )
    ),
    fixtureReady: !!(
      fixture?.writtenAt &&
      fixture.generation === source?.generation &&
      fixture.providerId === source?.reference.providerId &&
      fixture.status !== "mismatch"
    ),
  };
}
export const status = query({
  args,
  returns: forkViewValidator,
  handler: (ctx, input): Promise<ForkView> => read(ctx, input),
});
async function sourceFixture(
  ctx: Pick<QueryCtx, "auth" | "db" | "runQuery">,
  input: Input,
) {
  const view = await read(ctx, input);
  if (!view.source || !view.stopConfirmed || !view.fixtureReady)
    refuse(
      "Confirm the original nonforced source stop and prepared home fixture first.",
    );
  const source = view.source;
  const fixture = await ctx.db
    .query("liveFixtures")
    .withIndex("by_scope_and_key", (q) =>
      q.eq("scope", source.scope).eq("key", input.sourceKey),
    )
    .unique();
  if (!fixture) refuse("The original fixture is missing.");
  return { source, fixture };
}
export const admit = internalMutation({
  args,
  returns: v.boolean(),
  handler: async (ctx, input): Promise<boolean> => {
    const operationId = identity(input);
    const old = await read(ctx, input);
    if (old.intent) return false;
    const { source, fixture } = await sourceFixture(ctx, input);
    const scope = source.scope;
    const child = { scope, key: input.childKey };
    if (
      (await ctx.runQuery(components.sandbox.registry.get, {
        sandbox: child,
      })) ||
      (await ctx.runQuery(components.sandbox.lifecycle.getProvision, {
        sandbox: child,
      }))
    )
      refuse("The child key already has retained work.");
    const approval = await ctx.runQuery(internal.live.allowance.retained, {});
    if (!approval) refuse("Explicit run approval is required.");
    const reservation = await ctx.runMutation(internal.live.allowance.reserve, {
      runId: approval.plan.runId,
      intentKey: operationId,
      machineKey: input.childKey,
      kind: "fork",
    });
    if (!reservation.admitted) return false;
    const stop = (
      await ctx.runQuery(components.sandbox.operations.list, {
        sandbox: { scope, key: input.sourceKey },
        paginationOpts: { cursor: null, numItems: 50 },
      })
    ).page.find(
      (op) =>
        op.kind === "stop" &&
        op.status === "succeeded" &&
        op.generation === source.generation,
    );
    if (!stop) refuse("The original source stop is missing.");
    await ctx.db.insert("liveForks", {
      scope,
      sourceKey: input.sourceKey,
      sourceId: source.reference.providerId,
      sourceGeneration: source.generation,
      childKey: input.childKey,
      operationId,
      stopOperationId: stop.operationId,
      path: fixture.path,
      expectedText: fixture.expectedText,
      reservationId: reservation.reservationId,
      copy: "unverified",
    });
    return true;
  },
});
async function exactFiles(
  ctx: ActionCtx,
  c: Awaited<ReturnType<typeof ownedBoatClient>>,
  path: string,
  generation: number,
  providerId: string,
) {
  return c.providers.files({
    ...createFileStore(ctx, components.sandbox),
    getSandbox: async (sandbox) => {
      const row = await ctx.runQuery(components.sandbox.registry.get, {
        sandbox,
      });
      return row?.generation === generation &&
        row.reference.providerId === providerId
        ? row
        : null;
    },
    authorizePath: (input) =>
      input.path === path &&
      (input.maxBytes ?? 0) <= 512 &&
      input.reference.providerId === providerId,
  });
}
export const start = action({
  args,
  returns: forkViewValidator,
  handler: async (ctx, input): Promise<ForkView> => {
    identity(input);
    await requireOperator(ctx);
    const existing = await ctx.runQuery(api.live.fork.status, input);
    if (existing.intent) return existing;
    // Validate cached stop/fixture before account reads or billable admission.
    if (!existing.source || !existing.stopConfirmed || !existing.fixtureReady)
      refuse(
        "Confirm the original source stop and home fixture before forking.",
      );
    const c = await ownedBoatClient(ctx, input.sourceKey, "fork", true);
    const fixture = await ctx.runQuery(api.live.lifecycle.status, {
      key: input.sourceKey,
    });
    if (
      !fixture.fixture ||
      fixture.fixture.generation !== c.generation ||
      fixture.fixture.providerId !== c.reference.providerId
    )
      refuse("The source fixture changed.");
    const files = await exactFiles(
      ctx,
      c,
      fixture.fixture.path,
      c.generation,
      c.reference.providerId,
    );
    const bytes = await files.read({
      sandbox: c.sandbox,
      path: fixture.fixture.path,
      maxBytes: 512,
    });
    const expected = new TextEncoder().encode(fixture.fixture.expectedText),
      actual = new Uint8Array(bytes.data);
    if (
      bytes.truncated ||
      actual.length !== expected.length ||
      !actual.every((byte, i) => byte === expected[i])
    )
      refuse("The stopped source no longer matches its retained home fixture.");
    if (!(await ctx.runMutation(internal.live.fork.admit, input)))
      return ctx.runQuery(api.live.fork.status, input);
    const admitted = await ctx.runQuery(api.live.fork.status, input);
    if (!admitted.intent) throw Error("Fork intent missing");
    try {
      const operation = await c.providers
        .images(createImageStore(ctx, components.sandbox))
        .run({
          sandbox: c.sandbox,
          operationId: admitted.intent.operationId,
          kind: "fork",
        });
      if (operation.status === "unknown")
        await ctx.runMutation(internal.live.allowance.markUnknown, {
          reservationId: admitted.intent.reservationId,
        });
    } catch {
      await ctx.runMutation(internal.live.allowance.markUnknown, {
        reservationId: admitted.intent.reservationId,
      });
    }
    return ctx.runQuery(api.live.fork.status, input);
  },
});
export const bindChild = internalMutation({
  args,
  returns: v.null(),
  handler: async (ctx, input) => {
    const view = await read(ctx, input),
      intent = view.intent,
      op = view.operation;
    if (
      !intent ||
      op?.kind !== "fork" ||
      op.status !== "succeeded" ||
      op.generation !== intent.sourceGeneration ||
      op.reference.providerId !== intent.sourceId ||
      !view.source ||
      view.source.generation !== intent.sourceGeneration ||
      view.source.reference.providerId !== intent.sourceId
    )
      refuse("The original ready fork result is required.");
    const result = op.nativeImage?.result;
    if (
      !result ||
      !("machine" in result) ||
      result.machine.provider !== "boat" ||
      result.machine.providerId === intent.sourceId
    )
      refuse("A distinct ready child reference is required.");
    const operator = await requireOperator(ctx);
    const access = createHostAccess({
      authenticate: () => requireOperator(ctx),
      getSandbox: (sandbox) =>
        ctx.runQuery(components.sandbox.registry.get, { sandbox }),
      selectProvider: () => "boat",
      authorize: ({ principal, sandbox, operation }) =>
        principal.scope === operator.scope &&
        sandbox.scope === operator.scope &&
        sandbox.key === intent.childKey &&
        operation === "create",
    });
    const selected = await access.create({ key: intent.childKey });
    await access.authorizeCreate({
      sandbox: selected.sandbox,
      provider: selected.provider,
    });
    const child = await ctx.runMutation(components.sandbox.registry.ensure, {
      sandbox: selected.sandbox,
      reference: result.machine,
    });
    if (
      intent.childId &&
      (child.reference.providerId !== intent.childId ||
        child.generation !== intent.childGeneration)
    )
      refuse("The child binding changed.");
    await ctx.db.patch(intent._id, {
      childId: child.reference.providerId,
      childGeneration: child.generation,
    });
    return null;
  },
});
export const inspect = action({
  args,
  returns: forkViewValidator,
  handler: async (ctx, input): Promise<ForkView> => {
    const view = await ctx.runQuery(api.live.fork.status, input);
    await requireOperator(ctx);
    if (!view.intent || !view.operation?.nativeImage?.providerOperationId)
      return view;
    if (view.operation.status !== "succeeded") {
      const c = await ownedBoatClient(ctx, input.sourceKey, "imageStatus");
      if (
        c.generation !== view.intent.sourceGeneration ||
        c.reference.providerId !== view.intent.sourceId
      )
        refuse("The original source binding changed.");
      await c.providers
        .images(createImageStore(ctx, components.sandbox))
        .status({ sandbox: c.sandbox, operationId: view.intent.operationId });
    }
    const current = await ctx.runQuery(api.live.fork.status, input);
    if (current.operation?.status === "succeeded")
      await ctx.runMutation(internal.live.fork.bindChild, input);
    return ctx.runQuery(api.live.fork.status, input);
  },
});
export const copyResult = internalMutation({
  args: { ...args, matched: v.boolean() },
  returns: v.null(),
  handler: async (ctx, input) => {
    const view = await read(ctx, input),
      intent = view.intent;
    if (
      !intent ||
      !view.child ||
      view.child.reference.providerId !== intent.childId ||
      view.child.generation !== intent.childGeneration
    )
      refuse("The original child binding changed.");
    await ctx.db.patch(intent._id, {
      copy: input.matched ? "matched" : "mismatch",
    });
    return null;
  },
});
export const verify = action({
  args,
  returns: forkViewValidator,
  handler: async (ctx, input): Promise<ForkView> => {
    const view = await ctx.runQuery(api.live.fork.status, input);
    await requireOperator(ctx);
    const intent = view.intent;
    if (
      !intent?.childId ||
      !intent.childGeneration ||
      !view.child ||
      view.child.reference.providerId !== intent.childId ||
      view.child.generation !== intent.childGeneration
    )
      refuse("Register the original ready child before verifying copy bytes.");
    const c = await ownedBoatClient(ctx, input.childKey, "describe");
    if (
      c.generation !== intent.childGeneration ||
      c.reference.providerId !== intent.childId
    )
      refuse("The child binding changed.");
    await c.providers
      .lifecycle(createLifecycleStore(ctx, components.sandbox))
      .refresh(c.sandbox);
    const row = await ctx.runQuery(components.sandbox.registry.get, {
      sandbox: c.sandbox,
    });
    if (row?.observedState !== "running")
      refuse("Wait for child readiness before file verification.");
    const files = await exactFiles(
      ctx,
      c,
      intent.path,
      intent.childGeneration,
      intent.childId,
    );
    const bytes = await files.read({
        sandbox: c.sandbox,
        path: intent.path,
        maxBytes: 512,
      }),
      expected = new TextEncoder().encode(intent.expectedText),
      actual = new Uint8Array(bytes.data);
    const matched =
      !bytes.truncated &&
      actual.length === expected.length &&
      actual.every((byte, i) => byte === expected[i]);
    await ctx.runMutation(internal.live.fork.copyResult, { ...input, matched });
    return ctx.runQuery(api.live.fork.status, input);
  },
});
