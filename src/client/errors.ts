import { capabilityValidator, defineCapabilities } from "../capabilities.js";
import type {
  Capabilities,
  Capability,
  ProviderErrorData,
} from "../capabilities.js";

const messages: Record<ProviderErrorData["code"], string> = {
  unsupported: "Unsupported capability",
  validation: "Invalid provider data",
  authentication: "Provider authentication failed",
  authorization: "Provider access denied",
  quota: "Provider quota exceeded",
  rate_limit: "Provider rate limit exceeded",
  capacity: "Provider capacity unavailable",
  timeout: "Provider request timed out",
  stale_resource: "Provider resource is stale or missing",
  unknown_outcome: "Provider outcome is unknown",
  unknown_provider: "Unknown provider",
};

/** Adapters classify failures explicitly; never put raw SDK messages in this data. */
export class SandboxProviderError extends Error {
  readonly data: ProviderErrorData;

  constructor({
    code,
    outcome,
    retryable,
    providerCode,
    retryAfterMs,
    capability,
  }: Omit<ProviderErrorData, "version">) {
    super(messages[code]);
    this.name = "SandboxProviderError";
    if (
      (code === "unknown_outcome" && outcome !== "unknown") ||
      (capability !== undefined &&
        !capabilityValidator.members.some(
          (member) => member.value === capability,
        )) ||
      !Object.hasOwn(messages, code) ||
      !["not_started", "failed", "unknown"].includes(outcome) ||
      typeof retryable !== "boolean" ||
      (providerCode !== undefined && typeof providerCode !== "string") ||
      (retryAfterMs !== undefined &&
        (!Number.isFinite(retryAfterMs) || retryAfterMs < 0))
    )
      throw new Error("Invalid provider error");
    this.data = Object.freeze({
      version: 1,
      code,
      outcome,
      retryable,
      ...(providerCode !== undefined ? { providerCode } : {}),
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      ...(capability !== undefined ? { capability } : {}),
    });
  }
}

export function normalizeProviderError(error: unknown): SandboxProviderError {
  return error instanceof SandboxProviderError
    ? new SandboxProviderError(error.data)
    : new SandboxProviderError({
        code: "unknown_outcome",
        outcome: "unknown",
        retryable: false,
      });
}

export function requireCapability(
  capabilities: Capabilities,
  capability: Capability,
): void {
  if (!defineCapabilities(capabilities).supported.includes(capability))
    throw new SandboxProviderError({
      code: "unsupported",
      capability,
      outcome: "not_started",
      retryable: false,
    });
}

/** Advice only. No helper in this package automatically repeats an SDK call. */
export function retryAdvice(
  error: ProviderErrorData,
  effect: "read" | "write",
): "retry" | "reconcile" | "stop" {
  if (effect !== "read" && effect !== "write")
    throw new Error("Invalid retry effect");
  if (error.version !== 1) throw new Error("Invalid provider error version");
  error = new SandboxProviderError(error).data;
  if (effect === "write" && error.outcome === "unknown") return "reconcile";
  if (!error.retryable) return "stop";
  if (effect === "write" && error.outcome !== "not_started") return "stop";
  return "retry";
}
