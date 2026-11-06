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
test("round trip", async ({ page }) => {
  await page.goto(`${origin}/e2e/fixtures/files.html`);
  await page.getByRole("textbox", { name: "File contents" }).fill("hello 😀\n");
  await page.getByRole("button", { name: "Save and verify bytes" }).click();
  await expect(page.getByTestId("file-result")).toContainText(
    "Saved and read back 11 exact bytes",
  );
  await page.getByRole("textbox", { name: "File contents" }).fill("");
  await page.getByRole("button", { name: "Read selected file" }).click();
  await expect(
    page.getByRole("textbox", { name: "File contents" }),
  ).toHaveValue("hello 😀\n");
});
test("nonrecursive delete", async ({ page }) => {
  await page.goto(`${origin}/e2e/fixtures/files.html`);
  await page.getByRole("button", { name: "Save and verify bytes" }).click();
  await expect(
    page.getByRole("button", { name: "example.txt", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Delete selected file" }),
  ).toBeDisabled();
  await page
    .getByRole("textbox", { name: "Type the exact file name to delete" })
    .fill("example.txt");
  await page.getByRole("button", { name: "Delete selected file" }).click();
  await expect(page.getByTestId("file-result")).toContainText(
    "refreshed list omits that file",
  );
  await expect(
    page.getByRole("button", { name: "example.txt", exact: true }),
  ).toHaveCount(0);
});
test("oversized UTF8 is refused before write", async ({ page }) => {
  await page.goto(`${origin}/e2e/fixtures/files.html`);
  await page
    .getByRole("textbox", { name: "File contents" })
    .fill("😀".repeat(16385));
  await expect(
    page.getByRole("button", { name: "Save and verify bytes" }),
  ).toBeDisabled();
  await expect(page.getByTestId("file-write-count")).toHaveText("0");
  await expect(page.getByRole("alert")).toContainText("exceeds 64 KiB");
});
test("unknown write reply has no automatic replay", async ({ page }) => {
  await page.goto(`${origin}/e2e/fixtures/files.html?fail=1`);
  await page.getByRole("button", { name: "Save and verify bytes" }).click();
  await expect(page.getByRole("alert")).toContainText("No automatic retry");
  await page.getByRole("button", { name: "Refresh directory" }).click();
  await expect(page.getByTestId("file-write-count")).toHaveText("1");
});
