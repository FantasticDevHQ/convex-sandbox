import { expect, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
let server: ViteDevServer;
let origin: string;
test.beforeAll(async () => {
  server = await createServer({
    server: { host: "127.0.0.1", port: 0 },
    define: {
      "import.meta.env.VITE_CONVEX_URL": JSON.stringify(""),
      "import.meta.env.VITE_CLERK_PUBLISHABLE_KEY": JSON.stringify(""),
    },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string")
    throw new Error("No test server address");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await server?.close();
});
test("visible mode", async ({ page }, info) => {
  await page.goto(`${origin}/playground`);
  await expect(
    page.getByText("Simulator · no live provider", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Boat mode", exact: true }).click();
  await expect(page).toHaveURL(/\/setup$/);
  await expect(
    page.getByText("Boat · no simulated fallback", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Simulator · no live provider", { exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByText("Boat · no simulated fallback", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("boat-mode.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "Simulator mode", exact: true }).click();
  await expect(
    page.getByText("Simulator · no live provider", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Simulated provider", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("simulator-mode.png"),
    fullPage: true,
  });
});
test("no fallback", async ({ page }, info) => {
  await page.goto(`${origin}/e2e/fixtures/setup.html?fail=1`);
  await page.getByRole("button", { name: "Check read-only readiness" }).click();
  await expect(page.getByRole("alert")).toContainText("Boat readiness failed.");
  await expect(page.getByText("account-fixture", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByText("Simulated provider", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Provider reports starts available", { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("boat-failure.png"),
    fullPage: true,
  });
});
