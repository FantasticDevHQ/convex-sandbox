import type { Capabilities } from "../capabilities.js";
import type { SandboxAdapter, AuthorizeSandbox } from "./providers.js";
import type { PrepareExecution, ExecutionSnapshot } from "../execution.js";
import { normalizeSnapshot, normalizeLogPage } from "./executionProtocol.js";
import {
  normalizeProviderError,
  requireCapability,
  SandboxProviderError,
} from "./errors.js";

export function executionPreparer(
  getProvider: (name: string) => {
    adapter: SandboxAdapter;
    capabilities: Capabilities;
  },
  authorize: AuthorizeSandbox,
): PrepareExecution {
  return async ({ sandbox, reference, operation, sdkLogs }) => {
    const identity = Object.freeze({ scope: sandbox.scope, key: sandbox.key });
    const selected = Object.freeze({
      provider: reference.provider,
      providerId: reference.providerId,
    });
    await authorize(
      Object.freeze({ sandbox: identity, reference: selected, operation }),
    );
    const provider = getProvider(selected.provider);
    if (operation === "execute" || operation === "executionStatus")
      requireCapability(provider.capabilities, "execute");
    if (operation === "cancelExecution")
      requireCapability(provider.capabilities, "cancelExecution");
    if (sdkLogs) requireCapability(provider.capabilities, "executionLogs");
    const sdk = provider.adapter.execution;
    if (
      operation !== "executionGet" &&
      !(operation === "executionLogs" && !sdkLogs) &&
      (!sdk ||
        (operation === "cancelExecution" && typeof sdk.cancel !== "function") ||
        (sdkLogs && typeof sdk.logs !== "function"))
    )
      throw new SandboxProviderError({
        code: "unsupported",
        capability:
          operation === "cancelExecution"
            ? "cancelExecution"
            : sdkLogs
              ? "executionLogs"
              : "execute",
        outcome: "not_started",
        retryable: false,
      });
    const unavailable = () => {
      throw new SandboxProviderError({
        code: "unsupported",
        capability: "execute",
        outcome: "not_started",
        retryable: false,
      });
    };
    const snapshot = async (
      call: () => Promise<unknown>,
      expectedId?: string,
    ): Promise<ExecutionSnapshot> => {
      try {
        return normalizeSnapshot(await call(), expectedId);
      } catch (error) {
        throw normalizeProviderError(error);
      }
    };
    return {
      idempotency: sdk?.idempotency ?? "none",
      start: (input, context) =>
        operation === "execute" && sdk
          ? snapshot(() => sdk.start(selected.providerId, input, context))
          : Promise.reject(unavailable()),
      status: async (executionId, context) => {
        if (operation !== "executionStatus" || !sdk) return unavailable();
        if (executionId)
          return snapshot(
            () => sdk.status(selected.providerId, executionId, context),
            executionId,
          );
        if (!sdk.find) return null;
        const found = await sdk.find(
          selected.providerId,
          context.idempotencyKey,
          context,
        );
        return found === null ? null : normalizeSnapshot(found);
      },
      cancel: async (executionId, context) => {
        if (operation !== "cancelExecution" || !sdk?.cancel)
          return unavailable();
        const response: unknown = await sdk.cancel(
          selected.providerId,
          executionId,
          context,
        );
        if (!response || typeof response !== "object")
          throw new Error("Invalid cancellation acknowledgement");
        const acknowledged: unknown = Reflect.get(response, "acknowledged");
        if (typeof acknowledged !== "boolean")
          throw new Error("Invalid cancellation acknowledgement");
        return { acknowledged };
      },
      logs: async (executionId, cursor, context) => {
        if (operation !== "executionLogs" || !sdkLogs || !sdk?.logs)
          return unavailable();
        return normalizeLogPage(
          await sdk.logs(
            selected.providerId,
            executionId,
            { cursor, maxEntries: 16, maxBytes: 16384 },
            context,
          ),
        );
      },
    };
  };
}

export async function boundedSDK<T>(
  call: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 5000,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      call(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(
            new SandboxProviderError({
              code: "timeout",
              outcome: "unknown",
              retryable: false,
            }),
          );
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    throw normalizeProviderError(error);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
