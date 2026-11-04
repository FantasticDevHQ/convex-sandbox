import { v } from "convex/values";
import { internalAction } from "./_generated/server.js";
import { probeBoatSdk } from "../../scripts/boat/sdk-probe.js";
import { probeBoatTransport } from "../../scripts/boat/transport-probe.js";

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

export const transport = internalAction({
  args: {},
  returns: v.object({
    projection: v.boolean(),
    accountScoped: v.boolean(),
    aborted: v.boolean(),
    noRawErrors: v.boolean(),
  }),
  handler: async () => probeBoatTransport(),
});
