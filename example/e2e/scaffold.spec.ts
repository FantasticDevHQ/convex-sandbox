import { expect, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";

let server: ViteDevServer;
let origin: string;

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

test("TanStack routes navigate and reload without requiring a backend", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await expect(
    page.getByRole("heading", { name: "Your sandbox workbench." }),
  ).toBeVisible();
  await expect(page.getByText("Simulator · no live provider")).toBeVisible();
  await page.getByRole("link", { name: "Integration", exact: true }).click();
  await expect(page).toHaveURL(/\/integration$/);
  await expect(
    page.getByRole("heading", { name: "Mount the component." }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Mount the component." }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("integration.png"),
    fullPage: true,
  });
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Your sandbox workbench." }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("overview.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("starter navigation stays usable on a narrow viewport", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/integration`);
  await expect(
    page.getByRole("heading", { name: "Mount the component." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Navigation menu" }).click();
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your sandbox workbench." }),
  ).toBeVisible();
});

test("playground explains offline setup and offers no pretend provider", async ({
  page,
}) => {
  await page.goto(origin);
  await page.getByRole("link", { name: "Playground", exact: true }).click();
  await expect(page).toHaveURL(/\/playground$/);
  await expect(
    page.getByRole("heading", { name: "Your sandbox workbench." }),
  ).toBeVisible();
  await expect(
    page.getByText("Simulated provider", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No real VM or shell is running.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Connect a local backend" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create demo machines" }),
  ).toHaveCount(0);
});
