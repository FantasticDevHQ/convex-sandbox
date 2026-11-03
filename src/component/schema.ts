import { executionFields, logEntryValidator } from "../execution.js";
import { provisionFields } from "../lifecycle.js";
import { v } from "convex/values";
import { registryFields, operationFields } from "../state.js";
import { defineSchema, defineTable } from "convex/server";
import { observationFields } from "../contracts.js";
export { observationFields } from "../contracts.js";

export default defineSchema({
  executions: defineTable({
    ...executionFields,
    statusVersion: v.number(),
    statusLeaseUntil: v.number(),
    cancelVersion: v.number(),
    cancelLeaseUntil: v.number(),
    cancelDispatched: v.boolean(),
    logVersion: v.number(),
    logLeaseUntil: v.number(),
    providerCursor: v.union(v.string(), v.null()),
    logsComplete: v.boolean(),
    chunkCount: v.number(),
  }).index("by_scope_and_key_and_operationId", ["scope", "key", "operationId"]),
  executionLogs: defineTable({
    scope: v.string(),
    key: v.string(),
    operationId: v.string(),
    sequence: v.number(),
    ...logEntryValidator.fields,
  }).index("by_scope_and_key_and_operationId_and_sequence", [
    "scope",
    "key",
    "operationId",
    "sequence",
  ]),
  provisions: defineTable(provisionFields).index("by_scope_and_key", [
    "scope",
    "key",
  ]),
  sandboxes: defineTable({
    ...registryFields,
    operationCount: v.number(),
    nextSequence: v.number(),
  }).index("by_scope_and_key", ["scope", "key"]),
  operations: defineTable(operationFields)
    .index("by_scope_and_key_and_operationId", ["scope", "key", "operationId"])
    .index("by_scope_and_key_and_sequence", ["scope", "key", "sequence"])
    .index("by_scope_and_key_and_kind_and_sequence", [
      "scope",
      "key",
      "kind",
      "sequence",
    ]),
  observations: defineTable(observationFields).index("by_scope_and_key", [
    "scope",
    "key",
  ]),
});
