import type { SandboxState } from "../contracts.js";
import { SandboxProviderError } from "../client/errors.js";
import { hasControlCharacters } from "./transport.js";

const states: Record<string, SandboxState> = {
  init: "starting",
  provisioning: "starting",
  provisioned: "starting",
  cloning: "starting",
  ready: "running",
  idle: "running",
  running: "running",
  archiving: "stopping",
  archived: "stopped",
  error: "error",
  cancelled: "error",
};

export async function projectBoatObservation(
  response: Promise<unknown>,
  effect: "read" | "write",
  expectedId?: string,
) {
  const invalid = () =>
    new SandboxProviderError({
      code: "validation",
      outcome: effect === "write" ? "unknown" : "failed",
      retryable: false,
    });
  let raw: unknown;
  try {
    raw = await response;
  } catch (error) {
    if (error instanceof SyntaxError) throw invalid();
    throw error;
  }
  const result =
    raw && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : undefined;
  const value = result?.sandbox;
  const sandbox =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : undefined;
  if (
    result?.ok !== true ||
    !sandbox ||
    typeof sandbox.id !== "string" ||
    !sandbox.id ||
    sandbox.id.length > 1024 ||
    hasControlCharacters(sandbox.id) ||
    (expectedId !== undefined && sandbox.id !== expectedId) ||
    typeof sandbox.state !== "string" ||
    (sandbox.vcpu !== undefined &&
      (typeof sandbox.vcpu !== "number" ||
        !Number.isFinite(sandbox.vcpu) ||
        sandbox.vcpu <= 0))
  )
    throw invalid();
  return {
    providerId: sandbox.id,
    state: Object.hasOwn(states, sandbox.state)
      ? states[sandbox.state]
      : "unknown",
    // vcpu is an explicit count. No GB/GiB inference or size-table guessing.
    ...(sandbox.vcpu !== undefined
      ? { resources: { cpuCount: sandbox.vcpu } }
      : {}),
  };
}
