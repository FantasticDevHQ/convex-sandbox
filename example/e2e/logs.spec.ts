import { test, expect } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
let server: ViteDevServer;
let origin: string;
test.beforeAll(async () => {
  server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw Error("No address");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await server?.close();
});
test("no duplicates", async ({ page }) => {
  await page.goto(`${origin}/e2e/fixtures/logs.html`);
  await page
    .getByRole("button", { name: "Read next output" })
    .evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
  await expect(page.getByTestId("log-call-count")).toHaveText("1");
  await expect(page.getByTestId("log-stdout")).toHaveText("hello\nworld\n");
  await page.getByRole("button", { name: "Read next output" }).click();
  await expect(page.getByTestId("log-stdout")).toHaveText("hello\nworld\n");
  await expect(page.getByTestId("log-process-state")).toHaveText("running");
});
test("truncation", async ({ page }) => {
  await page.goto(`${origin}/e2e/fixtures/logs.html?truncated=1`);
  await page.getByRole("button", { name: "Read next output" }).click();
  await expect(page.getByTestId("log-bound")).toHaveText("Truncated");
  await expect(
    page.getByText("Output is truncated.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByTestId("log-process-state")).toHaveText("running");
});
test("reload retains cached output and next cursor", async ({ page }) => {
  await page.goto(`${origin}/e2e/fixtures/logs.html`);
  await page.getByRole("button", { name: "Read next output" }).click();
  await page.reload();
  await expect(page.getByTestId("log-stdout")).toHaveText("hello\nworld\n");
  await page.getByRole("button", { name: "Read next output" }).click();
  await expect(page.getByTestId("log-requested-cursor")).toHaveText("1");
  await expect(page.getByTestId("log-stdout")).toHaveText("hello\nworld\n");
});
test("refresh failure retains visible bytes", async ({ page }) => {
  await page.goto(`${origin}/e2e/fixtures/logs.html?fail=1`);
  await page.getByRole("button", { name: "Read next output" }).click();
  await expect(page.getByRole("alert")).toContainText("was not confirmed");
  await expect(page.getByTestId("log-stdout")).toHaveText("hello\n");
});
