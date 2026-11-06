import { v } from "convex/values";
import {
  registryRecordValidator,
  operationRecordValidator,
} from "@fantastic.dev/convex-sandbox";
export const forkFields = {
  scope: v.string(),
  sourceKey: v.string(),
  sourceId: v.string(),
  sourceGeneration: v.number(),
  childKey: v.string(),
  operationId: v.string(),
  stopOperationId: v.string(),
  path: v.string(),
  expectedText: v.string(),
  reservationId: v.id("liveReservations"),
  childId: v.optional(v.string()),
  childGeneration: v.optional(v.number()),
  copy: v.union(
    v.literal("unverified"),
    v.literal("matched"),
    v.literal("mismatch"),
  ),
};
export const forkIntentValidator = v.object({
  _id: v.id("liveForks"),
  _creationTime: v.number(),
  ...forkFields,
});
export const forkViewValidator = v.object({
  source: v.union(registryRecordValidator, v.null()),
  child: v.union(registryRecordValidator, v.null()),
  intent: v.union(forkIntentValidator, v.null()),
  operation: v.union(operationRecordValidator, v.null()),
  stopConfirmed: v.boolean(),
  stopOperationId: v.union(v.string(), v.null()),
  fixtureReady: v.boolean(),
});
