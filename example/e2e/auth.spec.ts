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

test("sign out", async ({ page }, info) => {
  await page.goto(`${origin}/e2e/fixtures/operator.html`);
  await expect(
    page.getByText("fixture-machine-private", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByText("fixture-machine-private", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Operator access", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("signed-out.png"),
    fullPage: true,
  });
});
test("sign out failure stays locked", async ({ page }) => {
  await page.goto(`${origin}/e2e/fixtures/operator.html?fail=1`);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByText("fixture-machine-private", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText(
    "Sign-out could not finish",
  );
});
test("unconfigured app never offers persona authority", async ({
  page,
}, info) => {
  await page.goto(`${origin}/setup`);
  await expect(
    page.getByRole("heading", { name: "Operator access" }),
  ).toBeVisible();
  await expect(
    page.getByText("Live actions are locked.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Create machine" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("operator-setup.png"),
    fullPage: true,
  });
});

test("sign-out lock survives private route remount", async ({ page }) => {
  await page.goto(`${origin}/e2e/fixtures/operator.html?fail=1`);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("button", { name: "Change private route" }).click();
  await expect(
    page.getByText("fixture-machine-private", { exact: true }),
  ).toHaveCount(0);
});
