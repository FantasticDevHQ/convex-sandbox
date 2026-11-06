import { v, type Infer } from "convex/values";
import { action } from "../_generated/server";
import { components } from "../_generated/api";
import {
  SandboxProviders,
  createImageStore,
  templatePageValidator,
  capabilitiesValidator,
} from "@fantastic.dev/convex-sandbox";
import { createHostAccess } from "@fantastic.dev/convex-sandbox/server";
import { createBoatProvider } from "@fantastic.dev/convex-sandbox/boat";
import { requireOperator } from "./operator";
import { refuse } from "./allowanceModel";
const result = v.object({
  page: templatePageValidator,
  capabilities: capabilitiesValidator,
});
export type CatalogView = Infer<typeof result>;
/** One read-only source catalog page; opening it grants no provisioning authority. */
export const load = action({
  args: { key: v.string(), generation: v.number(), providerId: v.string() },
  returns: result,
  handler: async (ctx, input): Promise<CatalogView> => {
    const access = createHostAccess({
      authenticate: () => requireOperator(ctx),
      getSandbox: (sandbox) =>
        ctx.runQuery(components.sandbox.registry.get, { sandbox }),
      authorize: ({ principal, sandbox, reference, operation }) =>
        principal.scope === sandbox.scope &&
        reference?.provider === "boat" &&
        operation === "listTemplates",
    });
    const resolved = await access.resolve({ key: input.key }, "listTemplates");
    const row = await ctx.runQuery(components.sandbox.registry.get, {
      sandbox: resolved.sandbox,
    });
    if (
      !row ||
      row.generation !== input.generation ||
      resolved.reference.providerId !== input.providerId
    )
      refuse("The selected source binding changed.");
    const apiKey = process.env.BOAT_API_KEY;
    if (!apiKey)
      refuse("Boat server configuration is required for the native catalog.");
    const provider = createBoatProvider({
      apiKey,
      org: process.env.BOAT_ORG ?? "personal",
    });
    const providers = new SandboxProviders({
      authorize: async (request) => {
        const current = await ctx.runQuery(components.sandbox.registry.get, {
          sandbox: resolved.sandbox,
        });
        if (
          current?.generation !== input.generation ||
          request.reference.providerId !== input.providerId
        )
          refuse("The selected source binding changed.");
        await access.authorize(request);
      },
    });
    providers.register(provider);
    const page = await providers
      .images(createImageStore(ctx, components.sandbox))
      .listTemplates({ sandbox: resolved.sandbox, cursor: null, limit: 50 });
    return { page, capabilities: provider.capabilities };
  },
});
