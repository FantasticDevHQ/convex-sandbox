import { expect, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
let server: ViteDevServer;
let origin: string;
test.beforeAll(async () => {
  server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string")
    throw new Error("No test server address");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await server?.close();
});
test("missing configuration", async ({ page }, info) => {
  await page.goto(`${origin}/e2e/fixtures/setup.html?missing=1`);
  await expect(
    page.getByText("BOAT_API_KEY is missing.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Check read-only readiness" }),
  ).toBeDisabled();
  await page.screenshot({
    path: info.outputPath("missing-key.png"),
    fullPage: true,
  });
});
test("read-only setup reports bounded provider facts without approval", async ({
  page,
}, info) => {
  await page.goto(`${origin}/e2e/fixtures/setup.html`);
  await page.getByRole("button", { name: "Check read-only readiness" }).click();
  await expect(
    page.getByText("account-fixture", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("0 / 2", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Provider reports starts available", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create machine" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("readiness.png"),
    fullPage: true,
  });
});
test("readiness failure remains retryable without invented provider facts", async ({
  page,
}) => {
  await page.goto(`${origin}/e2e/fixtures/setup.html?fail=1`);
  await page.getByRole("button", { name: "Check read-only readiness" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Readiness could not be checked",
  );
  await expect(page.getByText("account-fixture", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Check read-only readiness" }),
  ).toBeEnabled();
});
