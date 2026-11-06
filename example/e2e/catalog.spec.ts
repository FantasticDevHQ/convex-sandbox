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
test("pending item", async ({ page }) => {
  await page.goto(`${origin}/e2e/fixtures/catalog.html`);
  await page.getByRole("button", { name: "Read source catalog" }).click();
  await expect(page.getByText("demo-base", { exact: true })).toBeVisible();
  await expect(page.getByTestId("catalog-readiness").first()).toHaveText(
    "Pending · saving",
  );
  await expect(
    page.getByText("Partial catalog:", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Names are mutable", { exact: false }),
  ).toBeVisible();
});
test("unsupported capability", async ({ page }) => {
  await page.goto(`${origin}/e2e/fixtures/catalog.html`);
  await page.getByRole("button", { name: "Read source catalog" }).click();
  await expect(
    page.getByRole("button", { name: "Desktop access", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Unsupported. Native access cannot enforce", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /desktop|SSH/i })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Capture template" }),
  ).toBeDisabled();
});
test("failed refresh retains the prior observation with a stale notice", async ({
  page,
}) => {
  await page.goto(`${origin}/e2e/fixtures/catalog.html?fail=1`);
  await page.getByRole("button", { name: "Read source catalog" }).click();
  await expect(page.getByText("demo-base", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Read source catalog" }).click();
  await expect(page.getByRole("alert")).toContainText("older observation");
  await expect(page.getByText("demo-base", { exact: true })).toBeVisible();
});
