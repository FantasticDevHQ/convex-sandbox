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
test("pending deletion", async ({ page }) => {
  await page.goto(`${origin}/e2e/fixtures/delete.html`);
  const button = page.getByRole("button", { name: "Delete selected machine" });
  await expect(button).toBeDisabled();
  await page
    .getByRole("textbox", { name: "Type research-one to confirm" })
    .fill("research-one");
  await button.click();
  await expect(page.getByTestId("delete-phase")).toHaveText("Pending cleanup");
  await expect(page.getByText("delete-1", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Delete selected machine" }),
  ).toHaveCount(0);
});
test("completed deletion", async ({ page }) => {
  await page.goto(`${origin}/e2e/fixtures/delete.html`);
  await page.getByRole("textbox").fill("research-one");
  await page.getByRole("button", { name: "Delete selected machine" }).click();
  await page.getByRole("button", { name: "Inspect original deletion" }).click();
  await expect(page.getByTestId("delete-phase")).toHaveText(
    "Confirmed deletion",
  );
  await expect(page.getByRole("status")).toContainText(
    "tombstone records remain available",
  );
});
test("wrong target stays unresolved", async ({ page }) => {
  await page.goto(`${origin}/e2e/fixtures/delete.html?wrong=1`);
  await page.getByRole("textbox").fill("research-one");
  await page.getByRole("button", { name: "Delete selected machine" }).click();
  await page.getByRole("button", { name: "Inspect original deletion" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Cleanup remains unresolved",
  );
  await expect(page.getByTestId("delete-phase")).toHaveText(
    "Cleanup unresolved",
  );
});

test("changed binding requires fresh typed confirmation", async ({ page }) => {
  await page.goto(`${origin}/e2e/fixtures/delete.html`);
  await page.getByRole("textbox").fill("research-one");
  await expect(
    page.getByRole("button", { name: "Delete selected machine" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Inject rebound target" }).click();
  await expect(page.getByRole("textbox")).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Delete selected machine" }),
  ).toBeDisabled();
});
