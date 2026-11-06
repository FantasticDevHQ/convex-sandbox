import { test, expect } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
let server: ViteDevServer, origin: string;
declare global {
  interface Window {
    cleanupResets?: number;
    cleanupRequests?: number;
  }
}
test.beforeAll(async () => {
  server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw Error("No server address");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await server?.close();
});
test("guarded reset", async ({ page }, info) => {
  await page.goto(`${origin}/e2e/fixtures/cleanup.html?unknown=1`);
  await page.getByLabel("Type the exact run ID").fill("synthetic-run");
  await expect(
    page.getByRole("button", { name: "Reset run view" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Request next recorded deletion" }),
  ).toBeDisabled();
  await expect(
    page.getByText("No confirmed native ID", { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.cleanupResets ?? 0)).toBe(0);
  await page.reload();
  await expect(
    page.getByText("No confirmed native ID", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("guarded-reset.png"),
    fullPage: true,
  });
});
test("pending cleanup", async ({ page }, info) => {
  await page.goto(`${origin}/e2e/fixtures/cleanup.html`);
  await expect(
    page.getByRole("button", { name: "Request next recorded deletion" }),
  ).toBeDisabled();
  await page.getByLabel("Type the exact run ID").fill("synthetic-run");
  await page
    .getByRole("button", { name: "Request next recorded deletion" })
    .click();
  await expect(page.getByTestId("cleanup-target").first()).toContainText(
    "fork / pending",
  );
  await expect(
    page.getByRole("heading", { name: "Cleanup remains unresolved" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reset run view" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Request next recorded deletion" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Inspect original deletion" }).click();
  expect(await page.evaluate(() => window.cleanupRequests)).toBe(1);
  await page.screenshot({
    path: info.outputPath("cleanup-pending-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("cleanup-pending-mobile.png"),
    fullPage: true,
  });
});
test("completed view archives without erasing its proof", async ({ page }) => {
  await page.goto(`${origin}/e2e/fixtures/cleanup.html?terminal=1`);
  await page.getByLabel("Type the exact run ID").fill("synthetic-run");
  await page.getByRole("button", { name: "Reset run view" }).click();
  await expect(
    page.getByRole("heading", { name: "Run view archived" }),
  ).toBeVisible();
  await expect(page.getByTestId("cleanup-target")).toHaveCount(2);
  expect(await page.evaluate(() => window.cleanupResets)).toBe(1);
});
test("actual cleanup route requires operator configuration", async ({
  page,
}, info) => {
  await page.goto(`${origin}/cleanup`);
  await expect(
    page.getByRole("heading", { name: "Clean up this run", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Connect a managed local backend and configure a Clerk development",
      { exact: false },
    ),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("cleanup-access-gate.png"),
    fullPage: true,
  });
});
