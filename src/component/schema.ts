import { defineSchema, defineTable } from "convex/server";
import { observationFields } from "../contracts.js";
export { observationFields } from "../contracts.js";

export default defineSchema({
  observations: defineTable(observationFields).index("by_scope_and_key", [
    "scope",
    "key",
  ]),
});
