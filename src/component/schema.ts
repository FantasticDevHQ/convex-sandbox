import { v } from "convex/values";
import { registryFields, operationFields } from "../state.js";
import { defineSchema, defineTable } from "convex/server";
import { observationFields } from "../contracts.js";
export { observationFields } from "../contracts.js";

export default defineSchema({
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
