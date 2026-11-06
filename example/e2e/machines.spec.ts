import { expect, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
let server: ViteDevServer;
let origin: string;
test.beforeAll(async () => {
  server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string")
    throw new Error("No test address");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await server?.close();
});
test("unknown resources", async ({ page }, info) => {
  await page.goto(`${origin}/e2e/fixtures/machines.html`);
  await expect(page.getByTestId("memory-value")).toHaveText("Unknown");
  await expect(page.getByTestId("cpu-value")).toHaveText("Unknown");
  await page.screenshot({
    path: info.outputPath("unknown-resources.png"),
    fullPage: true,
  });
});
test("reactive refresh", async ({ page }, info) => {
  await page.goto(`${origin}/e2e/fixtures/machines.html`);
  await expect(page.getByTestId("accepted-state")).toHaveText("unknown");
  await page.getByRole("button", { name: "Refresh observation" }).click();
  await expect(page.getByTestId("accepted-state")).toHaveText("stopped");
  await expect(page.getByTestId("cpu-value")).toHaveText("2");
  await expect(page.getByTestId("memory-value")).toHaveText("Unknown");
  await page.screenshot({
    path: info.outputPath("accepted-refresh.png"),
    fullPage: true,
  });
});
test("failed refresh never claims a new accepted state", async ({ page }) => {
  await page.goto(`${origin}/e2e/fixtures/machines.html?fail=1`);
  await page.getByRole("button", { name: "Refresh observation" }).click();
  await expect(page.getByRole("alert")).toContainText("Refresh failed");
  await expect(page.getByTestId("accepted-state")).toHaveText("unknown");
  await expect(
    page.getByRole("button", { name: "Refresh observation" }),
  ).toBeEnabled();
});
