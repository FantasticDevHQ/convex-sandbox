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
test("duplicate clicks", async ({ page }) => {
  await page.goto(`${origin}/e2e/fixtures/create.html`);
  await page
    .getByRole("button", { name: "Create approved machine" })
    .evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
  await expect(page.getByTestId("creation-phase")).toHaveText(
    "Pending readiness",
  );
  await expect(page.getByTestId("synthetic-dispatch-count")).toHaveText("1");
});
test("pending readiness", async ({ page }) => {
  await page.goto(`${origin}/e2e/fixtures/create.html`);
  await page.getByRole("button", { name: "Create approved machine" }).click();
  await expect(page.getByTestId("creation-phase")).toHaveText(
    "Pending readiness",
  );
  await page
    .getByRole("button", { name: "Inject independent running observation" })
    .click();
  await expect(page.getByTestId("creation-phase")).toHaveText("Ready");
});
test("lost reply", async ({ page }) => {
  await page.goto(`${origin}/e2e/fixtures/create.html?lost=1`);
  await page.getByRole("button", { name: "Create approved machine" }).click();
  await expect(page.getByTestId("creation-phase")).toHaveText(
    "Unknown outcome",
  );
  await page.reload();
  await expect(page.getByTestId("creation-phase")).toHaveText(
    "Unknown outcome",
  );
  await expect(
    page.getByText("create-research-one", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create approved machine" }),
  ).toHaveCount(0);
});
