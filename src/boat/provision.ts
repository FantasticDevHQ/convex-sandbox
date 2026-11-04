import { SandboxProviderError } from "../client/errors.js";
import type { BoatOptions, BoatMachineType } from "./options.js";

export function provisionConfiguration(options: BoatOptions) {
  const machineType =
    options.machineType === undefined ? "small" : options.machineType;
  const ttlSeconds =
    options.ttlSeconds === undefined ? 3600 : options.ttlSeconds;
  if (
    !new Set<BoatMachineType>(["small", "default", "large", "xlarge"]).has(
      machineType,
    ) ||
    !Number.isSafeInteger(ttlSeconds) ||
    ttlSeconds < 1 ||
    ttlSeconds > 2592000
  ) {
    throw new SandboxProviderError({
      code: "validation",
      outcome: "not_started",
      retryable: false,
    });
  }
  return Object.freeze({
    machineType,
    ttlSeconds,
    org: options.org ?? "personal",
  });
}

/** Stable, bounded native key without tenant identity in the header. No new ledger. */
export async function nativeCreateKey(sharedKey: string) {
  if (typeof sharedKey !== "string" || !sharedKey || sharedKey.length > 16384) {
    throw new SandboxProviderError({
      code: "validation",
      outcome: "not_started",
      retryable: false,
    });
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(sharedKey),
  );
  return `csb-boat-v1-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
