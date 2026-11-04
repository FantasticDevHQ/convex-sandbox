import {
  BoatApi,
  Configuration,
  FetchError,
  ResponseError,
} from "@boatdev/sdk";
import type { ProviderCallContext } from "../lifecycle.js";
import { SandboxProviderError } from "../client/errors.js";
import type { ProviderErrorData } from "../capabilities.js";
import type { BoatOptions } from "./options.js";

export type { BoatOptions } from "./options.js";

const responseLimit = 1024 * 1024;
export function hasControlCharacters(value: string) {
  return [...value].some(
    (character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  );
}
function failure(
  code: ProviderErrorData["code"],
  outcome: ProviderErrorData["outcome"],
  retryable = false,
) {
  return new SandboxProviderError({ code, outcome, retryable });
}

function projectError(error: unknown, effect: "read" | "write") {
  if (error instanceof SandboxProviderError)
    return new SandboxProviderError(error.data);
  if (
    error instanceof FetchError &&
    error.cause instanceof SandboxProviderError
  )
    return new SandboxProviderError(error.cause.data);
  if (error instanceof ResponseError) {
    const status = error.response.status;
    const rejected: Record<number, ProviderErrorData["code"]> = {
      400: "validation",
      401: "authentication",
      402: "quota",
      403: "authorization",
      404: "stale_resource",
      413: "validation",
      422: "validation",
      429: "rate_limit",
    };
    if (rejected[status])
      return failure(rejected[status], "not_started", status === 429);
    if (status === 408 || status === 504)
      return failure(
        "timeout",
        effect === "write" ? "unknown" : "failed",
        effect === "read",
      );
    if (status === 503)
      return failure(
        "capacity",
        effect === "write" ? "unknown" : "failed",
        effect === "read",
      );
  }
  // Includes lost replies, ambiguous conflicts and SDK wrappers. Never keep cause,
  // raw response bodies, provider URLs, messages or credentials in shared errors.
  return failure("unknown_outcome", "unknown");
}

/** Internal leaf; the public API exports only the configured provider factory. */
export function createBoatTransport(options: BoatOptions) {
  if (
    !options ||
    typeof options.apiKey !== "string" ||
    !options.apiKey ||
    options.apiKey.length > 4096 ||
    /\s/.test(options.apiKey) ||
    hasControlCharacters(options.apiKey) ||
    (options.org !== undefined &&
      (typeof options.org !== "string" ||
        !options.org ||
        options.org.length > 256 ||
        options.org.trim() !== options.org ||
        hasControlCharacters(options.org))) ||
    (options.fetch !== undefined && typeof options.fetch !== "function")
  ) {
    throw failure("validation", "not_started");
  }
  // Snapshot configuration, not a mutable per-request active organization.
  const org = options.org ?? "personal";
  const fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const api = new BoatApi(
    new Configuration({
      basePath: "https://boat.dev/api/v1",
      accessToken: options.apiKey,
      headers: { "X-Boat-Org": org },
      middleware: [],
      fetchApi: async (url, init) => {
        if (init?.signal?.aborted) throw failure("timeout", "not_started");
        const response = await fetch(url, { ...init, redirect: "error" });
        if (!response.ok) {
          // Status-only classification: error text is neither parsed nor retained.
          void response.body?.cancel().catch(() => {});
          return new Response(null, { status: response.status });
        }
        if (!response.body) return response;
        const reader = response.body.getReader();
        const cancelRead = () => {
          void reader.cancel().catch(() => {});
        };
        init?.signal?.addEventListener("abort", cancelRead, { once: true });
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        try {
          for (;;) {
            if (init?.signal?.aborted) throw failure("timeout", "unknown");
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > responseLimit) {
              // Cancel without waiting for a remote stream to acknowledge it.
              void reader.cancel().catch(() => {});
              throw failure("validation", "unknown");
            }
            chunks.push(value);
          }
        } finally {
          init?.signal?.removeEventListener("abort", cancelRead);
          reader.releaseLock();
        }
        const body = new Uint8Array(bytes);
        let offset = 0;
        for (const chunk of chunks) {
          body.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return new Response(body, {
          status: response.status,
          headers: response.headers,
        });
      },
    }),
  );

  return {
    async call<T>(
      effect: "read" | "write",
      context: ProviderCallContext | undefined,
      invoke: (api: BoatApi, init: RequestInit) => Promise<T>,
    ): Promise<T> {
      if (context?.signal.aborted) throw failure("timeout", "not_started");
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let rejectAbort: (error: Error) => void = () => {};
      const aborted = new Promise<never>((_resolve, reject) => {
        rejectAbort = reject;
      });
      const abort = () => {
        controller.abort();
        rejectAbort(failure("timeout", "unknown"));
      };
      context?.signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(abort, 5000);
      try {
        return await Promise.race([
          Promise.resolve().then(() => {
            if (controller.signal.aborted)
              throw failure("timeout", "not_started");
            return invoke(api, { signal: controller.signal });
          }),
          aborted,
        ]);
      } catch (error) {
        throw projectError(error, effect);
      } finally {
        clearTimeout(timer);
        context?.signal.removeEventListener("abort", abort);
      }
    },
  };
}
