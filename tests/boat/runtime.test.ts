import { expect, test, vi } from "vitest";
import { probeBoatSdk } from "../../scripts/boat/sdk-probe.js";

test("the pinned SDK uses injected fetch, preserves request inputs and decodes detached commands", async () => {
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network request"));
  try {
    expect(await probeBoatSdk()).toEqual({
      injectedFetch: true,
      requestInputs: true,
      detachedCommand: true,
      abortForwarded: true,
      lostReplyNotRetried: true,
      httpErrorsNotRetried: true,
    });
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
  }
});
