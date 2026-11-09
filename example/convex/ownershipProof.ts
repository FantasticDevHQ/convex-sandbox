import { internalAction } from "./_generated/server";
import { internal, components } from "./_generated/api";
import { v } from "convex/values";
import {
  SandboxProviders,
  createLifecycleStore,
} from "@fantastic.dev/convex-sandbox";
import { ownershipProvider } from "./live/ownershipProvider";
import { requireOperator } from "./live/operator";
import { currentPlan, reviewToken } from "./live/allowanceModel";

/** Internal offline qualification through the production adapter/export/action/query path.
 * Fixed synthetic authority and exhaustive transport, never ambient Boat credentials/fetch. */
export const dispatch = internalAction({
  args: { unknown: v.boolean() },
  returns: v.object({ calls: v.number(), status: v.string() }),
  handler: async (
    ctx,
    { unknown },
  ): Promise<{ calls: number; status: string }> => {
    const operator = await requireOperator(ctx);
    const plan = currentPlan(operator.scope);
    if (
      operator.scope !== "example-boat:ownership-qualification" ||
      !/^ownership-qualification-(alpha|beta)$/.test(plan.runId) ||
      plan.accountId !== "synthetic-qualification-account" ||
      plan.wallet !== "personal"
    )
      throw Error("Use only the fixed synthetic ownership qualification run");
    await ctx.runMutation(internal.live.allowance.recordApproval, {
      reviewToken: reviewToken(plan),
      acknowledgeRisk: true,
    });
    const key = unknown ? "ownership-unknown" : "ownership-known";
    const operationId = `create-${key}`;
    const admission = await ctx.runMutation(internal.live.allowance.reserve, {
      runId: plan.runId,
      intentKey: operationId,
      machineKey: key,
      kind: "create",
    });
    let calls = 0;
    const providers = new SandboxProviders({
      authorize: async () => {},
      authorizeCreate: async () => {},
    });
    providers.register(
      ownershipProvider(
        ctx,
        {
          apiKey: "<OFFLINE_SYNTHETIC_KEY>",
          fetch: async (url, init) => {
            const parsed = new URL(String(url));
            if (
              parsed.origin !== "https://boat.dev" ||
              !parsed.pathname.startsWith("/api/v1/sandboxes") ||
              init?.method !== "POST"
            )
              throw Error("Unexpected synthetic ownership request");
            calls++;
            if (unknown) throw new TypeError("Synthetic lost creation reply");
            return new Response(
              JSON.stringify({
                ok: true,
                sandbox: { id: "synthetic-ownership-known", state: "ready" },
              }),
              { status: 202 },
            );
          },
        },
        key,
        "create",
      ),
    );
    const result = await providers
      .lifecycle(createLifecycleStore(ctx, components.sandbox))
      .create({
        sandbox: { scope: operator.scope, key },
        provider: "boat",
        operationId,
      });
    const provision =
      result.kind === "provision"
        ? result.provision
        : await ctx.runQuery(components.sandbox.lifecycle.getProvision, {
            sandbox: { scope: operator.scope, key },
          });
    if (!provision) throw Error("Expected original synthetic provision");
    if (provision.status === "unknown")
      await ctx.runMutation(internal.live.allowance.markUnknown, {
        reservationId: admission.reservationId,
      });
    await ctx.runAction(internal.live.ownership.retain, {
      key,
      kind: "create",
    });
    return { calls, status: provision.status };
  },
});
