import { test, expect } from "@playwright/test";
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
test("accepted stop", async ({ page }) => {
  await page.goto(`${origin}/e2e/fixtures/lifecycle.html`);
  await page.getByRole("button", { name: "Stop owned machine" }).click();
  await expect(page.getByTestId("lifecycle-state")).toHaveText("stopping");
  await expect(
    page.getByText("Native job retained for read-only reconciliation."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Resume approved machine" }),
  ).toBeDisabled();
});
test("disk persistence", async ({ page }) => {
  await page.goto(`${origin}/e2e/fixtures/lifecycle.html`);
  await page
    .getByRole("button", { name: "Prepare retained home fixture" })
    .click();
  await page.getByRole("button", { name: "Stop owned machine" }).click();
  await page
    .getByRole("button", { name: "Inspect progress and verify bytes" })
    .click();
  await expect(page.getByTestId("lifecycle-state")).toHaveText("stopped");
  await page.getByRole("button", { name: "Resume approved machine" }).click();
  await expect(page.getByTestId("persistence-state")).toHaveText(
    "Awaiting resume verification",
  );
  await page
    .getByRole("button", { name: "Inspect progress and verify bytes" })
    .click();
  await expect(page.getByTestId("lifecycle-state")).toHaveText("running");
  await expect(page.getByTestId("persistence-state")).toHaveText(
    "Bytes verified",
  );
});
test("changed bytes fail verification", async ({ page }) => {
  await page.goto(`${origin}/e2e/fixtures/lifecycle.html?mismatch=1`);
  await page
    .getByRole("button", { name: "Prepare retained home fixture" })
    .click();
  await page.getByRole("button", { name: "Stop owned machine" }).click();
  await page
    .getByRole("button", { name: "Inspect progress and verify bytes" })
    .click();
  await page.getByRole("button", { name: "Resume approved machine" }).click();
  await page
    .getByRole("button", { name: "Inspect progress and verify bytes" })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Persistence verification failed",
  );
});
