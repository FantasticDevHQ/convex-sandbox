import { query, action } from "../_generated/server";
import { v } from "convex/values";
import { readBoatSetup } from "@fantastic.dev/convex-sandbox/boat";
import { requireOperator } from "./operator";

const configurationFields = {
  keyConfigured: v.boolean(),
  missing: v.array(v.literal("BOAT_API_KEY")),
  wallet: v.union(v.string(), v.null()),
};
const optionalNumber = v.union(v.number(), v.null());
const optionalString = v.union(v.string(), v.null());
const readinessFields = {
  ...configurationFields,
  state: v.union(
    v.literal("missing"),
    v.literal("checked"),
    v.literal("unavailable"),
  ),
  accountId: optionalString,
  walletTeamId: optionalString,
  canStart: v.union(v.boolean(), v.null()),
  activeSandboxes: optionalNumber,
  maxActiveSandboxes: optionalNumber,
};
function serverConfiguration() {
  const key = process.env.BOAT_API_KEY ?? "";
  const org = process.env.BOAT_ORG ?? "personal";
  // Never echo a credential even if misconfigured into a wallet selector.
  const safeWallet =
    org.length > 0 &&
    org.length <= 256 &&
    org.trim() === org &&
    ![...org].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) &&
    (!key || !org.includes(key))
      ? org
      : null;
  return {
    keyConfigured: key.length > 0,
    missing: key ? [] : ["BOAT_API_KEY" as const],
    wallet: safeWallet,
  };
}

export const configuration = query({
  args: {},
  returns: v.object(configurationFields),
  handler: async (ctx) => {
    await requireOperator(ctx);
    return serverConfiguration();
  },
});

export const readiness = action({
  args: {},
  returns: v.object(readinessFields),
  handler: async (ctx) => {
    await requireOperator(ctx);
    const configuration = serverConfiguration();
    const empty = {
      ...configuration,
      accountId: null,
      walletTeamId: null,
      canStart: null,
      activeSandboxes: null,
      maxActiveSandboxes: null,
    };
    if (!configuration.keyConfigured)
      return { ...empty, state: "missing" as const };
    if (!configuration.wallet)
      return { ...empty, state: "unavailable" as const };
    try {
      const result = await readBoatSetup({
        apiKey: process.env.BOAT_API_KEY ?? "",
        org: configuration.wallet,
      });
      return { ...configuration, ...result, state: "checked" as const };
    } catch {
      // Provider bodies, error messages and credentials never leave the action.
      return { ...empty, state: "unavailable" as const };
    }
  },
});
