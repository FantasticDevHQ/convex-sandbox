import { registerProvider } from "../client/providers.js";
import { defineCapabilities } from "../capabilities.js";
import { SandboxProviderError } from "../client/errors.js";
import { createBoatTransport, hasControlCharacters } from "./transport.js";
import type { BoatOptions } from "./options.js";
import { projectBoatObservation } from "./observation.js";
import { nativeCreateKey, provisionConfiguration } from "./provision.js";

export type { BoatOptions, BoatMachineType } from "./options.js";

/** Construct inside a trusted host action. Use shared lifecycle clients for claims. */
export function createBoatProvider(options: BoatOptions) {
  const transport = createBoatTransport(options);
  const configuration = provisionConfiguration(options);
  return registerProvider({
    name: "boat",
    createIdempotency: "native",
    capabilities: defineCapabilities({
      version: 1,
      supported: ["create", "describe"],
    }),
    adapter: {
      async create(request, context) {
        if (
          request.templateId !== undefined ||
          (request.resources && Object.keys(request.resources).length)
        ) {
          throw new SandboxProviderError({
            code: "unsupported",
            capability: "create",
            outcome: "not_started",
            retryable: false,
          });
        }
        return transport.call("write", context, async (api, init) => {
          const idempotencyKey = await nativeCreateKey(context.idempotencyKey);
          return projectBoatObservation(
            api.create(
              {
                org: configuration.org,
                idempotencyKey,
                createSandboxRequest: {
                  type: configuration.machineType,
                  ttlSeconds: configuration.ttlSeconds,
                  noEnv: true,
                  snapshots: true,
                  visibility: "private",
                },
              },
              init,
            ),
            "write",
          );
        });
      },
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
        return transport.call("read", context, (api, init) =>
          projectBoatObservation(api.get({ sandboxId: id }, init), "read", id),
        );
      },
    },
  });
}
