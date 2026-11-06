import {
  action,
  query,
  type ActionCtx,
  type QueryCtx,
} from "../_generated/server";
import type {
  RegistryRecord,
  ProvisionRecord,
} from "@fantastic.dev/convex-sandbox";
import {
  createLifecycleStore,
  SandboxProviders,
  registryRecordValidator,
  provisionRecordValidator,
} from "@fantastic.dev/convex-sandbox";
import { createHostAccess } from "@fantastic.dev/convex-sandbox/server";
import {
  createBoatProvider,
  readBoatSetup,
} from "@fantastic.dev/convex-sandbox/boat";
import { components, internal, api } from "../_generated/api";
import { v } from "convex/values";
import { requireOperator } from "./operator";
import { currentPlan, refuse } from "./allowanceModel";
const args = { key: v.string() };
const view = v.object({
  key: v.string(),
  operationId: v.string(),
  reservationHeld: v.boolean(),
  reservationAt: v.union(v.number(), v.null()),
  reservationUnknown: v.boolean(),
  provision: v.union(provisionRecordValidator, v.null()),
  registry: v.union(registryRecordValidator, v.null()),
});
export type CreationView = {
  key: string;
  operationId: string;
  reservationHeld: boolean;
  reservationAt: number | null;
  reservationUnknown: boolean;
  provision: ProvisionRecord | null;
  registry: RegistryRecord | null;
};
function identity(key: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(key) || key === "new")
    refuse(
      "Use a machine key of 1–80 letters, digits, dots, underscores or hyphens.",
    );
  return `create-${key}`;
}
async function read(
  ctx: Pick<QueryCtx, "auth" | "db" | "runQuery">,
  key: string,
): Promise<CreationView> {
  const operator = await requireOperator(ctx);
  const operationId = identity(key);
  const sandbox = { scope: operator.scope, key };
  const reservation = await ctx.db
    .query("liveReservations")
    .withIndex("by_scope_and_machineKey_and_kind", (q) =>
      q.eq("scope", operator.scope).eq("machineKey", key).eq("kind", "create"),
    )
    .unique();
  const provision = await ctx.runQuery(
    components.sandbox.lifecycle.getProvision,
    { sandbox },
  );
  const registry = await ctx.runQuery(components.sandbox.registry.get, {
    sandbox,
  });
  if (
    (provision && provision.provider !== "boat") ||
    (registry && registry.reference.provider !== "boat")
  )
    refuse("This logical key belongs to a different workflow.");
  return {
    key,
    operationId,
    reservationHeld: reservation !== null,
    reservationAt: reservation?.createdAt ?? null,
    reservationUnknown: reservation?.status === "unknown",
    provision,
    registry,
  };
}
export const status = query({
  args,
  returns: view,
  handler: (ctx, { key }) => read(ctx, key),
});
function accessFor(ctx: Pick<ActionCtx, "auth" | "runQuery">) {
  return createHostAccess({
    authenticate: () => requireOperator(ctx),
    getSandbox: (sandbox) =>
      ctx.runQuery(components.sandbox.registry.get, { sandbox }),
    selectProvider: () => "boat",
    authorize: ({ principal, sandbox, operation, reference }) =>
      principal.scope === sandbox.scope &&
      (operation === "create" ||
        (reference?.provider === "boat" &&
          ["get", "describe"].includes(operation))),
  });
}
export const create = action({
  args,
  returns: view,
  handler: async (ctx, { key }): Promise<CreationView> => {
    const operator = await requireOperator(ctx);
    const operationId = identity(key);
    // Inspect existing durable work first, including after expiry. A retry never dispatches.
    const existing = await ctx.runQuery(api.live.create.status, { key });
    if (existing.reservationHeld || existing.provision || existing.registry)
      return existing;
    const plan = currentPlan(operator.scope);
    const apiKey = process.env.BOAT_API_KEY;
    if (!apiKey) refuse("Boat server credentials are not configured.");
    let account: Awaited<ReturnType<typeof readBoatSetup>>;
    try {
      account = await readBoatSetup({ apiKey, org: plan.wallet });
    } catch {
      refuse("Boat account could not be verified. No creation was admitted.");
    }
    if (
      account.accountId !== plan.accountId ||
      account.walletTeamId !== plan.walletTeamId ||
      account.canStart === false
    )
      refuse(
        "Boat account or start availability does not match the reviewed run.",
      );
    const access = accessFor(ctx);
    const { sandbox, provider } = await access.create({ key });
    const reservation = await ctx.runMutation(internal.live.allowance.reserve, {
      runId: plan.runId,
      intentKey: operationId,
      machineKey: key,
      kind: "create",
    });
    if (!reservation.admitted)
      return ctx.runQuery(api.live.create.status, { key });
    try {
      const providers = new SandboxProviders({
        authorize: access.authorize,
        authorizeCreate: access.authorizeCreate,
      });
      providers.register(
        createBoatProvider({
          apiKey,
          org: plan.wallet,
          machineType: plan.size,
          ttlSeconds: plan.durationMinutes * 60,
        }),
      );
      const result = await providers
        .lifecycle(createLifecycleStore(ctx, components.sandbox))
        .create({ sandbox, provider, operationId });
      if (result.kind === "provision" && result.provision.status === "unknown")
        await ctx.runMutation(internal.live.allowance.markUnknown, {
          reservationId: reservation.reservationId,
        });
    } catch {
      // A failed action boundary proves neither non-dispatch nor deletion. Keep its exact intent.
      await ctx.runMutation(internal.live.allowance.markUnknown, {
        reservationId: reservation.reservationId,
      });
    }
    return ctx.runQuery(api.live.create.status, { key });
  },
});
