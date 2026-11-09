import { type Infer, v } from "convex/values";

export const capabilityValidator = v.union(
  v.literal("create"),
  v.literal("describe"),
  v.literal("start"),
  v.literal("stop"),
  v.literal("delete"),
  v.literal("execute"),
  v.literal("cancelExecution"),
  v.literal("executionLogs"),
  v.literal("readFile"),
  v.literal("writeFile"),
  v.literal("listFiles"),
  v.literal("deleteFile"),
  v.literal("transferFile"),
  v.literal("listTemplates"),
  v.literal("createTemplate"),
  v.literal("createFromTemplate"),
  v.literal("fork"),
  v.literal("restore"),
  v.literal("snapshotDisk"),
  v.literal("suspendMemory"),
  v.literal("resumeMemory"),
  v.literal("getConnection"),
  v.literal("getDesktopSession"),
);
export type Capability = Infer<typeof capabilityValidator>;
const persistenceValidator = v.union(
  v.literal("retained"),
  v.literal("discarded"),
  v.literal("unknown"),
);
export const capabilitiesValidator = v.object({
  version: v.literal(1),
  supported: v.array(capabilityValidator),
  persistence: v.optional(
    v.object({
      diskOnStop: persistenceValidator,
      memoryOnStop: persistenceValidator,
    }),
  ),
  limits: v.optional(
    v.object({
      idleTimeoutMs: v.optional(v.number()),
      maxLifetimeMs: v.optional(v.number()),
      diskRetentionMs: v.optional(v.number()),
      maxExecutionMs: v.optional(v.number()),
      maxFileBytes: v.optional(v.number()),
    }),
  ),
  nativeFeatures: v.optional(v.array(v.string())),
});
export type Capabilities = Infer<typeof capabilitiesValidator>;

/** Validate server-owned metadata and snapshot it before any adapter call. */
export function defineCapabilities(input: Capabilities): Capabilities {
  const invalid = () => {
    throw new Error("Invalid capabilities");
  };
  const object = (
    value: unknown,
    keys: string[],
  ): value is Record<string, unknown> => {
    return (
      !!value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).every((key) => keys.includes(key))
    );
  };
  if (
    !object(input, [
      "version",
      "supported",
      "persistence",
      "limits",
      "nativeFeatures",
    ]) ||
    input.version !== 1 ||
    !Array.isArray(input.supported)
  )
    return invalid();
  if (
    !input.supported.every((name) =>
      capabilityValidator.members.some((member) => member.value === name),
    )
  )
    return invalid();
  const result: Capabilities = {
    version: 1,
    supported: [...new Set(input.supported)],
  };
  if (input.persistence !== undefined) {
    if (
      !object(input.persistence, ["diskOnStop", "memoryOnStop"]) ||
      ![input.persistence.diskOnStop, input.persistence.memoryOnStop].every(
        (value) =>
          persistenceValidator.members.some((member) => member.value === value),
      )
    )
      return invalid();
    result.persistence = {
      diskOnStop: input.persistence.diskOnStop,
      memoryOnStop: input.persistence.memoryOnStop,
    };
    Object.freeze(result.persistence);
  }
  if (input.limits !== undefined) {
    const keys = [
      "idleTimeoutMs",
      "maxLifetimeMs",
      "diskRetentionMs",
      "maxExecutionMs",
      "maxFileBytes",
    ] as const;
    if (!object(input.limits, [...keys])) return invalid();
    result.limits = {};
    for (const key of keys) {
      const value = input.limits[key];
      if (value === undefined) continue;
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
        return invalid();
      result.limits[key] = value;
    }
    Object.freeze(result.limits);
  }
  if (input.nativeFeatures !== undefined) {
    if (
      !Array.isArray(input.nativeFeatures) ||
      !input.nativeFeatures.every(
        (name) => typeof name === "string" && /^[^.]+\..+$/.test(name),
      )
    )
      return invalid();
    result.nativeFeatures = [...new Set(input.nativeFeatures)];
    Object.freeze(result.nativeFeatures);
  }
  Object.freeze(result.supported);
  return Object.freeze(result);
}

export const providerErrorCodeValidator = v.union(
  v.literal("unsupported"),
  v.literal("validation"),
  v.literal("authentication"),
  v.literal("authorization"),
  v.literal("quota"),
  v.literal("rate_limit"),
  v.literal("capacity"),
  v.literal("timeout"),
  v.literal("stale_resource"),
  v.literal("unknown_outcome"),
  v.literal("unknown_provider"),
);
export const providerErrorValidator = v.object({
  version: v.literal(1),
  code: providerErrorCodeValidator,
  outcome: v.union(
    v.literal("not_started"),
    v.literal("failed"),
    v.literal("unknown"),
  ),
  retryable: v.boolean(),
  providerCode: v.optional(v.string()),
  retryAfterMs: v.optional(v.number()),
  capability: v.optional(capabilityValidator),
});
export type ProviderErrorData = Infer<typeof providerErrorValidator>;
