import { demoTables } from "./demo/schema.js";
import { approvalFields, reservationFields } from "./live/allowanceModel";
import { defineTable } from "convex/server";
import { defineSchema } from "convex/server";

export default defineSchema({
  ...demoTables,
  liveApprovals: defineTable(approvalFields).index("by_scope", ["scope"]),
  liveReservations: defineTable(reservationFields)
    .index("by_scope_and_runId_and_intentKey", ["scope", "runId", "intentKey"])
    .index("by_scope_and_machineKey_and_kind", ["scope", "machineKey", "kind"]),
});
