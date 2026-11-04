import { registerProvider } from "../client/providers.js";
import { defineCapabilities } from "../capabilities.js";
import type { SandboxState } from "../contracts.js";
import { SandboxProviderError } from "../client/errors.js";
import {
  createBoatTransport,
  hasControlCharacters,
  type BoatOptions,
} from "./transport.js";

export type { BoatOptions } from "./transport.js";

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

/** Construct inside a trusted host action. This initial entry supports observation only. */
export function createBoatProvider(options: BoatOptions) {
  const transport = createBoatTransport(options);
  return registerProvider({
    name: "boat",
    capabilities: defineCapabilities({ version: 1, supported: ["describe"] }),
    adapter: {
      async describe(id, context) {
        if (
          typeof id !== "string" ||
          !id ||
          id.length > 1024 ||
          hasControlCharacters(id)
        ) {
          throw new SandboxProviderError({
            code: "validation",
            outcome: "not_started",
            retryable: false,
          });
        }
        return transport.call("read", context, async (api, init) => {
          const result = await api
            .get({ sandboxId: id }, init)
            .catch((error) => {
              if (error instanceof SyntaxError)
                throw new SandboxProviderError({
                  code: "validation",
                  outcome: "failed",
                  retryable: false,
                });
              throw error;
            });
          if (
            result?.ok !== true ||
            result.sandbox?.id !== id ||
            typeof result.sandbox.state !== "string"
          ) {
            throw new SandboxProviderError({
              code: "validation",
              outcome: "failed",
              retryable: false,
            });
          }
          return {
            providerId: id,
            state: states[result.sandbox.state] ?? "unknown",
          };
        });
      },
    },
  });
}
