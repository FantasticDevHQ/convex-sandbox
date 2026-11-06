import { test, expect } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
let server: ViteDevServer, origin: string;
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
async function approve(page: import("@playwright/test").Page) {
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Fork stopped source" }).click();
}
test("snapshot boundary", async ({ page }) => {
  await page.goto(`${origin}/e2e/fixtures/fork.html?pending=1`);
  await page.getByRole("checkbox").check();
  await expect(
    page.getByRole("button", { name: "Fork stopped source" }),
  ).toBeDisabled();
  await expect(page.getByTestId("fork-count")).toHaveText("0");
});
test("retained copy", async ({ page }) => {
  await page.goto(`${origin}/e2e/fixtures/fork.html`);
  await approve(page);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Verify retained copy" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Inspect original fork" }).click();
  await expect(page.getByTestId("fork-source")).toContainText(
    "synthetic-source",
  );
  await expect(page.getByTestId("fork-child")).toContainText("synthetic-child");
  await page.getByRole("button", { name: "Verify retained copy" }).click();
  await expect(page.getByTestId("fork-copy")).toHaveText("Copy bytes match");
  await expect(page.getByTestId("fork-count")).toHaveText("1");
});
test("unknown child never replays", async ({ page }) => {
  await page.goto(`${origin}/e2e/fixtures/fork.html?unknown=1`);
  await approve(page);
  await page.reload();
  await page.getByRole("button", { name: "Inspect original fork" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "unresolved child intent",
  );
  await expect(page.getByTestId("fork-count")).toHaveText("1");
  await expect(
    page.getByRole("button", { name: "Fork stopped source" }),
  ).toHaveCount(0);
});
test("mismatched child bytes remain explicit", async ({ page }) => {
  await page.goto(`${origin}/e2e/fixtures/fork.html?mismatch=1`);
  await approve(page);
  await page.getByRole("button", { name: "Inspect original fork" }).click();
  await page.getByRole("button", { name: "Verify retained copy" }).click();
  await expect(page.getByRole("alert")).toContainText("Child bytes differ");
});
