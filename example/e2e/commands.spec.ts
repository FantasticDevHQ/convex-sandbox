import { test, expect } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
let server: ViteDevServer;
let origin: string;
test.beforeAll(async () => {
  server = await createServer({
    server: { host: "127.0.0.1", port: 0 },
    plugins: [{
      name: "offline-command-hooks",
      enforce: "pre",
      transform(code, id) {
        if (id.endsWith("/src/commands.tsx"))
          return code.replace('from "convex/react"', 'from "../e2e/fixtures/command-hooks"');
      },
    }],
  });
  await server.listen();
  const a = server.httpServer?.address();
  if (!a || typeof a === "string") throw Error("No address");
  origin = `http://127.0.0.1:${a.port}`;
});
test.afterAll(async () => {
  await server?.close();
});
test("retained execution", async ({ page }) => {
  await page.goto(`${origin}/e2e/fixtures/commands.html`);
  await page.getByRole("button", { name: "Run detached command" }).click();
  await expect(page.getByTestId("execution-identity")).toHaveText(
    "synthetic-native-history",
  );
  const id = await page.getByTestId("command-operation").textContent();
  await page.reload();
  await expect(page.getByTestId("command-operation")).toHaveText(id ?? "");
  await expect(page.getByTestId("execution-identity")).toHaveText(
    "synthetic-native-history",
  );
  await expect(page.getByTestId("synthetic-command-count")).toHaveText("1");
});
test("exit code", async ({ page }) => {
  await page.goto(`${origin}/e2e/fixtures/commands.html`);
  await page.getByRole("button", { name: "Run detached command" }).click();
  await expect(page.getByTestId("execution-state")).toHaveText("running");
  await page.getByRole("button", { name: "Inspect command status" }).click();
  await expect(page.getByTestId("execution-state")).toHaveText("completed");
  await expect(page.getByTestId("execution-exit-code")).toHaveText("17");
});
test("unknown start is retained without replay", async ({ page }) => {
  await page.goto(`${origin}/e2e/fixtures/commands.html?unknown=1`);
  await page.getByRole("button", { name: "Run detached command" }).click();
  await expect(page.getByRole("alert")).toContainText("outcome is unknown");
  await page.getByRole("button", { name: "Inspect command status" }).click();
  await expect(page.getByTestId("execution-state")).toHaveText("unknown");
  await expect(page.getByTestId("synthetic-command-count")).toHaveText("1");
  await expect(
    page.getByRole("button", { name: "Run detached command" }),
  ).toHaveCount(0);
});
test("rejected submission keeps the original operation and error", async ({
  page,
}) => {
  await page.goto(`${origin}/e2e/fixtures/commands.html?fail=1`);
  await page.getByRole("button", { name: "Run detached command" }).click();
  await expect(page.getByRole("alert")).toContainText("was not confirmed");
  await expect(page.getByTestId("command-operation")).toContainText("command-");
  await expect(
    page.getByRole("button", { name: "Run detached command" }),
  ).toHaveCount(0);
});

test("production router retains rejected original submission", async ({ page }) => {
  await page.goto(`${origin}/e2e/fixtures/command-route.html`);
  await page.getByRole("button", { name: "Run detached command" }).click();
  await expect(page.getByTestId("selected-operation")).toContainText("command-");
  await expect(page.getByRole("alert")).toContainText("was not confirmed");
  await expect(page.getByTestId("command-operation")).toHaveText(
    await page.getByTestId("selected-operation").textContent() ?? "",
  );
  await expect(page.getByRole("button", { name: "Run detached command" })).toHaveCount(0);
});
