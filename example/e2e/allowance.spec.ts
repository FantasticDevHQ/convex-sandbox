import { expect, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
let server: ViteDevServer;
let origin: string;
test.beforeAll(async () => {
  server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
  await server.listen();
  const a = server.httpServer?.address();
  if (!a || typeof a === "string") throw Error("No address");
  origin = `http://127.0.0.1:${a.port}`;
});
test.afterAll(async () => {
  await server?.close();
});
test("review cost", async ({ page }) => {
  await page.goto(`${origin}/e2e/fixtures/allowance.html`);
  await expect(page.getByTestId("run-estimate")).toHaveText("$0.20");
  await expect(
    page.getByText(/Cleanup failure, stopped resources/),
  ).toBeVisible();
  await expect(
    page.getByText(/not a provider-enforced billing cap/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve reviewed run" }),
  ).toBeDisabled();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Approve reviewed run" }).click();
  await expect(page.getByTestId("approval-status")).toHaveText("Active");
  await expect(
    page.getByRole("region", { name: "Durable run ledger" }),
  ).toBeVisible();
});
test("expired review and failed account verification cannot imply approval", async ({
  page,
}) => {
  await page.goto(`${origin}/e2e/fixtures/allowance.html?expired=1`);
  await expect(page.getByRole("checkbox")).toBeDisabled();
  await expect(page.getByTestId("approval-status")).toHaveText("Expired");
  await page.goto(`${origin}/e2e/fixtures/allowance.html?fail=1`);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Approve reviewed run" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Approval could not be recorded",
  );
  await expect(page.getByTestId("approval-status")).toHaveText("Not active");
});
