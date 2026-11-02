import { SandboxBoundary } from "@fantastic.dev/convex-sandbox";
import type { ComponentApi } from "@fantastic.dev/convex-sandbox/_generated/component.js";
import { internalAction, internalQuery } from "./_generated/server.js";
import { components } from "./_generated/api.js";
import { v } from "convex/values";

const sandbox: ComponentApi = components.sandbox;
const observationFields = {
  scope: v.string(),
  key: v.string(),
  provider: v.string(),
  providerId: v.string(),
  state: v.union(v.literal("running"), v.literal("stopped")),
};

// Server-only synthetic proof. This is not a public, unauthenticated sandbox API.
const boundary = new SandboxBoundary({
  simulated: {
    describe: async (id) => ({
      id,
      state: "running",
      token: "synthetic-not-a-credential",
    }),
  },
});

export const observe = internalAction({
  args: {},
  returns: v.object(observationFields),
  handler: async (ctx) =>
    boundary.observe(
      {
        scope: "internal-fixture",
        key: "proof",
        provider: "simulated",
        providerId: "fixture-1",
      },
      async (observation) => {
        await ctx.runMutation(sandbox.observations.record, observation);
      },
    ),
});

export const latest = internalQuery({
  args: {},
  returns: v.union(v.null(), v.object(observationFields)),
  handler: async (ctx) =>
    ctx.runQuery(sandbox.observations.get, {
      scope: "internal-fixture",
      key: "proof",
    }),
});
