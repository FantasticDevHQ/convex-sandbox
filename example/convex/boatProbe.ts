import { v } from "convex/values";
import { internalAction } from "./_generated/server.js";
import { probeBoatSdk } from "../../scripts/boat/sdk-probe.js";

// Internal synthetic audit fixture, never a live Boat endpoint.
export const runtime = internalAction({
  args: {},
  returns: v.object({
    injectedFetch: v.boolean(),
    requestInputs: v.boolean(),
    detachedCommand: v.boolean(),
    abortForwarded: v.boolean(),
    lostReplyNotRetried: v.boolean(),
    httpErrorsNotRetried: v.boolean(),
  }),
  handler: async () => probeBoatSdk(),
});
