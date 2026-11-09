import type { ActionCtx } from "../_generated/server";
import { internal, components } from "../_generated/api";
import { SandboxProviders } from "@fantastic.dev/convex-sandbox";
import { createHostAccess } from "@fantastic.dev/convex-sandbox/server";
import {
  createBoatProvider,
  readBoatSetup,
} from "@fantastic.dev/convex-sandbox/boat";
import { requireOperator } from "./operator";
import { ownershipProvider } from "./ownershipProvider";
import { currentPlan, refuse } from "./allowanceModel";
function accessFor(ctx: Pick<ActionCtx, "auth" | "runQuery">) {
  return createHostAccess({
    authenticate: () => requireOperator(ctx),
    getSandbox: (sandbox) =>
      ctx.runQuery(components.sandbox.registry.get, { sandbox }),
    authorize: ({ principal, sandbox, reference, operation }) =>
      principal.scope === sandbox.scope &&
      reference?.provider === "boat" &&
      [
        "get",
        "describe",
        "start",
        "stop",
        "readFile",
        "writeFile",
        "listFiles",
        "deleteFile",
        "delete",
        "execute",
        "executionGet",
        "executionStatus",
        "executionLogs",
        "fork",
        "imageStatus",
      ].includes(operation),
  });
}
export async function ownedBoatClient(
  ctx: ActionCtx,
  key: string,
  operation:
    | "stop"
    | "start"
    | "readFile"
    | "writeFile"
    | "listFiles"
    | "deleteFile"
    | "describe"
    | "delete"
    | "execute"
    | "executionGet"
    | "executionStatus"
    | "executionLogs"
    | "fork"
    | "imageStatus",
  billable = false,
  childKey?: string,
) {
  const access = accessFor(ctx);
  const resolved = await access.resolve({ key }, operation);
  const bound = await ctx.runQuery(components.sandbox.registry.get, {
    sandbox: resolved.sandbox,
  });
  if (
    !bound ||
    bound.reference.provider !== resolved.reference.provider ||
    bound.reference.providerId !== resolved.reference.providerId
  )
    refuse("The selected binding changed.");
  const operator = await requireOperator(ctx);
  const approval = await ctx.runQuery(internal.live.allowance.retained, {});
  const plan = approval?.plan;
  if (
    !plan ||
    plan.scope !== operator.scope ||
    plan.wallet !== (process.env.BOAT_ORG ?? "personal")
  )
    refuse("The original reviewed account is required.");
  if (billable) {
    currentPlan(operator.scope, approval?.reviewToken);
    if (
      !approval ||
      Date.now() >= approval.approvedAt + plan.durationMinutes * 60_000
    )
      refuse("Run duration has expired.");
  }
  const apiKey = process.env.BOAT_API_KEY;
  if (!apiKey) refuse("Boat server configuration is required.");
  let account: Awaited<ReturnType<typeof readBoatSetup>>;
  try {
    account = await readBoatSetup({ apiKey, org: plan.wallet });
  } catch {
    refuse("The exact reviewed account could not be verified.");
  }
  if (
    account.accountId !== plan.accountId ||
    account.walletTeamId !== plan.walletTeamId ||
    (billable && account.canStart === false)
  )
    refuse("The reviewed account does not permit this operation.");
  const providers = new SandboxProviders({
    authorize: async (input) => {
      if (
        input.reference.provider !== resolved.reference.provider ||
        input.reference.providerId !== resolved.reference.providerId
      )
        refuse("The selected binding changed.");
      const current = await ctx.runQuery(components.sandbox.registry.get, {
        sandbox: resolved.sandbox,
      });
      if (current?.generation !== bound.generation)
        refuse("The selected binding changed.");
      await access.authorize(input);
    },
  });
  providers.register(
    childKey
      ? ownershipProvider(
          ctx,
          {
            apiKey,
            org: plan.wallet,
            ttlSeconds: plan.durationMinutes * 60,
          },
          childKey,
          "fork",
        )
      : createBoatProvider({
          apiKey,
          org: plan.wallet,
          ttlSeconds: plan.durationMinutes * 60,
        }),
  );
  return { ...resolved, generation: bound.generation, access, providers, plan };
}
