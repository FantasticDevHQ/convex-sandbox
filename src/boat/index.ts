import { registerProvider } from "../client/providers.js";
import { defineCapabilities } from "../capabilities.js";
import { SandboxProviderError } from "../client/errors.js";
import { createBoatTransport } from "./transport.js";
import type { BoatOptions } from "./options.js";
import { projectBoatObservation } from "./observation.js";
import { nativeCreateKey, provisionConfiguration } from "./provision.js";
import { createBoatFiles, BOAT_INLINE_FILE_LIMIT } from "./files.js";
import { createBoatExecution } from "./execution.js";
import { createBoatLifecycle } from "./lifecycle.js";

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
      supported: [
        "create",
        "describe",
        "start",
        "stop",
        "delete",
        "execute",
        "executionLogs",
        "readFile",
        "writeFile",
        "listFiles",
        "deleteFile",
      ],
      limits: { maxFileBytes: BOAT_INLINE_FILE_LIMIT },
      persistence: { diskOnStop: "unknown", memoryOnStop: "discarded" },
    }),
    adapter: {
      files: createBoatFiles(transport),
      execution: createBoatExecution(transport),
      ...createBoatLifecycle(transport, configuration.ttlSeconds),
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
    },
  });
}
