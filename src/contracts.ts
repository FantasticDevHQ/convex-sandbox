import { type Infer, v } from "convex/values";

/** Opaque application identity. Resolve scope from trusted host authorization. */
export const sandboxKeyValidator = v.object({
  scope: v.string(),
  key: v.string(),
});
export type SandboxKey = Infer<typeof sandboxKeyValidator>;

/** Replaceable physical identity, separate from the application's logical key. */
export const providerReferenceValidator = v.object({
  provider: v.string(),
  providerId: v.string(),
});
export type ProviderReference = Infer<typeof providerReferenceValidator>;

/** Allocated resources, when reported. Missing fields mean unknown, not zero. */
export const machineResourcesValidator = v.object({
  cpuCount: v.optional(v.number()),
  memoryMiB: v.optional(v.number()),
  diskMiB: v.optional(v.number()),
});
export type MachineResources = Infer<typeof machineResourcesValidator>;

export const sandboxStateValidator = v.union(
  v.literal("starting"),
  v.literal("running"),
  v.literal("stopping"),
  v.literal("stopped"),
  v.literal("paused"),
  v.literal("deleted"),
  v.literal("error"),
  v.literal("unknown"),
);
export type SandboxState = Infer<typeof sandboxStateValidator>;

export const sandboxDescriptionValidator = v.object({
  sandbox: sandboxKeyValidator,
  reference: providerReferenceValidator,
  state: sandboxStateValidator,
  resources: v.optional(machineResourcesValidator),
});
export type SandboxDescription = Infer<typeof sandboxDescriptionValidator>;

/** Serializable handles, not credentials, SDK instances or execution callbacks. */
export const operationHandleValidator = v.object({
  sandbox: sandboxKeyValidator,
  operationId: v.string(),
});
export type OperationHandle = Infer<typeof operationHandleValidator>;
export const executionHandleValidator = v.object({
  ...operationHandleValidator.fields,
  reference: providerReferenceValidator,
  executionId: v.string(),
});
export type ExecutionHandle = Infer<typeof executionHandleValidator>;
export const operationStatusValidator = v.union(
  v.literal("pending"),
  v.literal("running"),
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("cancelled"),
);
export type OperationStatus = Infer<typeof operationStatusValidator>;

/** Legacy boundary proof; deliberately narrower than the common lifecycle. */
export const observationFields = {
  ...sandboxKeyValidator.fields,
  ...providerReferenceValidator.fields,
  state: v.union(v.literal("running"), v.literal("stopped")),
};
export const observationValidator = v.object(observationFields);
export type Observation = Infer<typeof observationValidator>;
export type SandboxIdentity = Omit<Observation, "state">;

/** A lifecycle response describes observed state, not a completion guarantee. */
export const lifecycleResultValidator = v.object({
  ...sandboxDescriptionValidator.fields,
  operation: v.optional(operationHandleValidator),
});
export type LifecycleResult = Infer<typeof lifecycleResultValidator>;
