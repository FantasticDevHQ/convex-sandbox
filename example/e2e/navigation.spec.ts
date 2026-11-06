import { expect, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";

let server: ViteDevServer;
let origin: string;
const workflows = [
  "Overview",
  "Setup",
  "Machines",
  "Commands",
  "Files",
  "Forks",
  "Operations",
  "Cleanup",
  "Integration",
  "Playground",
];
test.beforeAll(async () => {
  server = await createServer({
    server: { host: "127.0.0.1", port: 0 },
    define: { "import.meta.env.VITE_CONVEX_URL": JSON.stringify("") },
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

test("active route", async ({ page }) => {
  await page.goto(origin);
  const nav = page.getByRole("navigation", { name: "Primary" });
  for (const name of workflows) {
    await nav.getByRole("link", { name, exact: true }).click();
    await expect(nav.getByRole("link", { name, exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
  }
});

test("deep link reload", async ({ page }) => {
  await page.goto(`${origin}/machines/example-machine`);
  await expect(
    page.getByRole("heading", { name: "Machine details" }),
  ).toBeVisible();
  await expect(
    page.getByText("example-machine", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/machines\/example-machine$/);
  await expect(
    page.getByRole("heading", { name: "Machine details" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation")
      .getByRole("link", { name: "Machines", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});

test("mobile navigation", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin);
  const menu = page.getByRole("button", { name: "Navigation menu" });
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  for (const name of workflows) {
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await nav.getByRole("link", { name, exact: true }).click();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#main-content")).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await menu.click();
  await page.screenshot({
    path: info.outputPath("mobile-navigation.png"),
    fullPage: true,
  });
});
