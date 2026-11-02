import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  fullyParallel: false,
  outputDir:
    process.env.CSB_PLAYWRIGHT_OUTPUT ??
    join(tmpdir(), `convex-sandbox-e2e-${process.pid}`),
  reporter: "list",
  use: {
    viewport: { width: 1440, height: 1000 },
    video: "on",
    screenshot: "only-on-failure",
  },
});
