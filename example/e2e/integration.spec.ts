import { test, expect } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { readFile } from "node:fs/promises";
const manifest = JSON.parse(
  await readFile(
    new URL("../shared/integration-examples.json", import.meta.url),
    "utf8",
  ),
) as Array<{ id: string; title: string; sourcePath: string; href: string }>;
let server: ViteDevServer, origin: string;
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
test("matching example", async ({ page, context }, info) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`${origin}/files`);
  await page
    .getByText("Developer view · Files example", { exact: true })
    .click();
  const expected = await readFile(
    new URL("../convex/live/files.ts", import.meta.url),
    "utf8",
  );
  await expect(page.getByTestId("checked-source")).toHaveText(expected);
  await expect(
    page.getByRole("heading", { name: "Files consumer example" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Copy checked source" }).click();
  await expect(page.getByRole("status")).toHaveText("Source copied.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    expected,
  );
  await page.screenshot({
    path: info.outputPath("files-developer-view.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "Open Files workflow" }).click();
  await expect(page).toHaveURL(/\/files$/);
});
test("every example shows its exact checked module and links to its workflow", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const example of manifest) {
    await page.goto(`${origin}/integration?workflow=${example.id}`);
    await page
      .getByText(`Developer view · ${example.title} example`, { exact: true })
      .click();
    const expected = await readFile(
      new URL(`../${example.sourcePath}`, import.meta.url),
      "utf8",
    );
    await expect(page.getByTestId("checked-source")).toHaveText(expected);
    await expect(
      page.getByRole("link", {
        name: `Open ${example.title} workflow`,
        exact: false,
      }),
    ).toHaveAttribute("href", example.href);
  }
  await page.goto(`${origin}/integration?workflow=files`);
  await page
    .getByText("Developer view · Files example", { exact: true })
    .click();
  await page.screenshot({
    path: info.outputPath("integration-desktop.png"),
    fullPage: true,
  });
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Files", exact: true }).last(),
  ).toHaveAttribute("aria-current", "page");
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByText("Developer view · Files example", { exact: true })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("integration-mobile.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
