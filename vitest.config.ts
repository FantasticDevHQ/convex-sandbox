import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "example/convex/live/*.test.ts"],
    maxWorkers: 1,
  },
});
