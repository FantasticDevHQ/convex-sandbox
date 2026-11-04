import { v } from "convex/values";
import { internalAction } from "./_generated/server.js";
import { components } from "./_generated/api.js";
import {
  createLifecycleStore,
  createExecutionStore,
  createFileStore,
  createImageStore,
} from "@fantastic.dev/convex-sandbox";
import { runAdapterConformance } from "@fantastic.dev/convex-sandbox/testing";
import { boatConformanceFixture } from "../fixtures/boatConformance.js";

export const runtime = internalAction({
  args: {},
  returns: v.object({
    passed: v.number(),
    skipped: v.number(),
    total: v.number(),
    cancellationUnsupported: v.boolean(),
  }),
  handler: async (ctx) => {
    let index = 0;
    const scope = `boat-conformance-${Date.now()}`;
    const stores = {
      lifecycle: createLifecycleStore(ctx, components.sandbox),
      execution: createExecutionStore(ctx, components.sandbox),
      files: {
        ...createFileStore(ctx, components.sandbox),
        authorizePath: ({ path }: { path: string }) =>
          path === "/tmp/boat-conformance" ||
          path.startsWith("/tmp/boat-conformance/"),
      },
      images: createImageStore(ctx, components.sandbox),
    };
    const report = await runAdapterConformance(() =>
      boatConformanceFixture(stores, { scope, key: `case-${index++}` }),
    );
    const skipped = report.filter((item) => item.status === "skipped");
    return {
      passed: report.filter((item) => item.status === "passed").length,
      skipped: skipped.length,
      total: report.length,
      cancellationUnsupported:
        skipped.length === 1 &&
        skipped[0].name === "cancellation acknowledgement" &&
        skipped[0].reason === "requires execute, cancelExecution",
    };
  },
});
