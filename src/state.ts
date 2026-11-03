import { type Infer, v } from "convex/values";
import {
  capabilityValidator,
  providerErrorCodeValidator,
} from "./capabilities.js";
import {
  providerReferenceValidator,
  sandboxStateValidator,
  machineResourcesValidator,
  operationStatusValidator,
} from "./contracts.js";

export const requestedStateValidator = v.union(
  v.literal("running"),
  v.literal("stopped"),
  v.literal("deleted"),
);
export const refreshValidator = v.union(
  v.object({ status: v.literal("never") }),
  v.object({ status: v.literal("pending") }),
  v.object({ status: v.literal("stale") }),
  v.object({ status: v.literal("fresh") }),
  v.object({
    status: v.literal("failed"),
    errorCode: providerErrorCodeValidator,
  }),
);
export const registryFields = {
  scope: v.string(),
  key: v.string(),
  reference: providerReferenceValidator,
  generation: v.number(),
  version: v.number(),
  requestedState: v.optional(requestedStateValidator),
  observedState: sandboxStateValidator,
  resources: v.optional(machineResourcesValidator),
  tombstone: v.boolean(),
  refreshSequence: v.number(),
  observedSequence: v.number(),
  refresh: refreshValidator,
  observedAt: v.optional(v.number()),
  updatedAt: v.number(),
  activeOperationId: v.optional(v.string()),
};
export const registryRecordValidator = v.object(registryFields);
export type RegistryRecord = Infer<typeof registryRecordValidator>;
export const trackedOperationStatusValidator = operationStatusValidator;
export const operationFields = {
  scope: v.string(),
  key: v.string(),
  operationId: v.string(),
  kind: capabilityValidator,
  reference: providerReferenceValidator,
  generation: v.number(),
  sequence: v.number(),
  version: v.number(),
  status: trackedOperationStatusValidator,
  executionId: v.optional(v.string()),
  leaseUntil: v.optional(v.number()),
  observationSequence: v.optional(v.number()),
  errorCode: v.optional(providerErrorCodeValidator),
  createdAt: v.number(),
  updatedAt: v.number(),
};
export const operationRecordValidator = v.object(operationFields);
export type OperationRecord = Infer<typeof operationRecordValidator>;
/** History is bounded per logical sandbox; older completed handles expire. */
export const OPERATION_HISTORY_LIMIT = 100;
export const refreshTicketValidator = v.object({
  generation: v.number(),
  sequence: v.number(),
});
export const registryPageValidator = v.object({
  page: v.array(registryRecordValidator),
  isDone: v.boolean(),
  continueCursor: v.string(),
});
export const operationPageValidator = v.object({
  page: v.array(operationRecordValidator),
  isDone: v.boolean(),
  continueCursor: v.string(),
});
