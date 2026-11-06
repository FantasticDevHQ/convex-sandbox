import type { BoatOptions } from "./options.js";
import { createBoatTransport, hasControlCharacters } from "./transport.js";
import { SandboxProviderError } from "../client/errors.js";

export type BoatSetupReadiness = {
  accountId: string;
  wallet: string;
  walletTeamId: string | null;
  canStart: boolean | null;
  activeSandboxes: number | null;
  maxActiveSandboxes: number | null;
};

/** Read-only account/wallet projection. This never approves or provisions a run. */
export async function readBoatSetup(
  options: Pick<BoatOptions, "apiKey" | "org" | "fetch">,
): Promise<BoatSetupReadiness> {
  const transport = createBoatTransport(options);
  const org = options.org ?? "personal";
  const account = await transport.call("read", undefined, (api, init) =>
    api.me(init),
  );
  const limits = await transport.call("read", undefined, (api, init) =>
    api.limits({ org }, init),
  );
  const safeId = (value: unknown): value is string =>
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    !hasControlCharacters(value) &&
    !value.includes(options.apiKey);
  if (
    !account.ok ||
    !limits.ok ||
    !safeId(account.user?.id) ||
    !safeId(org) ||
    (org === "personal" && limits.teamId != null) ||
    (org !== "personal" && !safeId(limits.teamId))
  )
    throw new SandboxProviderError({
      code: "validation",
      outcome: "failed",
      retryable: false,
    });
  const count = (value: unknown) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0
      ? value
      : null;
  const canStart =
    account.user.suspended === true || account.user.closed === true
      ? false
      : typeof limits.canStart === "boolean"
        ? limits.canStart
        : null;
  return {
    accountId: account.user.id,
    wallet: org,
    walletTeamId: org === "personal" ? null : (limits.teamId ?? null),
    canStart,
    activeSandboxes: count(limits.activeSandboxes),
    maxActiveSandboxes: count(limits.maxActiveSandboxes),
  };
}
