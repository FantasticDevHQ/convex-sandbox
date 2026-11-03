import { ConvexError } from "convex/values";
import type { ProviderErrorData } from "../capabilities.js";
import { SandboxProviderError } from "../client/errors.js";

/** Drop raw messages, stack/cause and providerCode, which can contain credentials. */
export function serializeSandboxError(error: unknown): ProviderErrorData {
  const data =
    error instanceof SandboxProviderError
      ? error.data
      : {
          code: "unknown_outcome" as const,
          outcome: "unknown" as const,
          retryable: false,
        };
  return {
    version: 1,
    code: data.code,
    outcome: data.outcome,
    retryable: data.retryable,
    ...("capability" in data && data.capability !== undefined
      ? { capability: data.capability }
      : {}),
  };
}
export async function withSandboxErrors<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw new ConvexError(serializeSandboxError(error));
  }
}
export function hostError(
  code: "validation" | "authentication" | "authorization" | "unsupported",
): never {
  throw new SandboxProviderError({
    code,
    outcome: "not_started",
    retryable: false,
  });
}
export async function safeHostCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw new SandboxProviderError(serializeSandboxError(error));
  }
}
