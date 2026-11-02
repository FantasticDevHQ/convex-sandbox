import { SandboxBoundary } from "../../src/client/index.js";
import { observationFields } from "../../src/component/schema.js";
import { internalAction, internalQuery } from "./_generated/server.js";
import { components } from "./_generated/api.js";
import { v } from "convex/values";

// Server-only synthetic proof. This is not a public, unauthenticated sandbox API.
const boundary = new SandboxBoundary({
  simulated: {
    describe: async (id) => ({ id, state: "running", token: "synthetic-not-a-credential" }),
  },
});

export const observe = internalAction({
  args: {},
  returns: v.object(observationFields),
  handler: async (ctx) => boundary.observe(
    { scope: "internal-fixture", key: "proof", provider: "simulated", providerId: "fixture-1" },
    async observation => { await ctx.runMutation(components.sandbox.observations.record, observation); },
  ),
});

export const latest = internalQuery({
  args: {},
  returns: v.union(v.null(), v.object(observationFields)),
  handler: async (ctx) => ctx.runQuery(components.sandbox.observations.get, {
    scope: "internal-fixture", key: "proof",
  }),
});
