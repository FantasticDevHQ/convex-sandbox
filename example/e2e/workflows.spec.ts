import { test, expect } from "@playwright/test";
import type { ViteDevServer } from "vite";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOfflineServer } from "./helpers/offline-vite";
import {
  createMountedBackend,
  SyntheticBoatHTTP,
  trapBrowserNetwork,
} from "./helpers/mounted-workflows";
let server: ViteDevServer, origin: string;
test.beforeAll(async () => {
  server = await createOfflineServer();
  await server.listen();
  const a = server.httpServer?.address();
  if (!a || typeof a === "string") throw Error("No address");
  origin = `http://127.0.0.1:${a.port}`;
});
test.afterAll(async () => {
  await server?.close();
});
test("credential-free scenario", async ({ page }, info) => {
  const backend = await createMountedBackend();
  const browser = await trapBrowserNetwork(page, origin);
  try {
    await page.exposeFunction("workflowRpc", backend.rpc);
    await page.goto(`${origin}/e2e/fixtures/workflows.html`);
    await expect(
      page.getByRole("heading", { name: "Mounted offline workflows" }),
    ).toBeVisible();
    await page
      .getByRole("checkbox", { name: /I approve this bounded run/ })
      .check();
    await page.getByRole("button", { name: "Approve reviewed run" }).click();
    await expect(
      page.getByRole("heading", { name: "This reviewed run is approved." }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Create workflow" }).click();
    await page.getByRole("button", { name: "Create approved machine" }).click();
    await expect(page.getByTestId("creation-phase")).toHaveText(
      "Pending readiness",
    );
    await page.getByRole("button", { name: "Refresh observation" }).click();
    await expect(page.getByTestId("creation-phase")).toHaveText("Ready");
    await page.getByRole("button", { name: "Files workflow" }).click();
    await page.getByLabel("File contents").fill("mounted exact bytes\n");
    await page.getByRole("button", { name: "Save and verify bytes" }).click();
    await expect(page.getByTestId("file-result")).toContainText(
      "Saved and read back",
    );
    await page.getByRole("button", { name: "Commands workflow" }).click();
    await page.getByRole("button", { name: "Run detached command" }).click();
    await page.getByRole("button", { name: "Inspect command status" }).click();
    await expect(page.getByTestId("execution-state")).toHaveText("completed");
    await page.getByRole("button", { name: "Read next output" }).click();
    await expect(page.getByTestId("log-stdout")).toHaveText("mounted output\n");
    const callsBeforeReload = backend.http.requests.length;
    await page.reload();
    await expect(page.getByTestId("execution-state")).toHaveText("completed");
    await expect(page.getByTestId("log-stdout")).toHaveText("mounted output\n");
    expect(backend.http.requests).toHaveLength(callsBeforeReload);
    await page.getByRole("button", { name: "Recovery workflow" }).click();
    await expect(page.getByTestId("retained-operation")).toHaveCount(1);
    await page.getByRole("button", { name: "Catalog workflow" }).click();
    await page.getByRole("button", { name: "Read source catalog" }).click();
    await expect(page.getByText("offline-base", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Lifecycle workflow" }).click();
    await page
      .getByRole("button", { name: "Prepare retained home fixture" })
      .click();
    await page.getByRole("button", { name: "Stop owned machine" }).click();
    await page
      .getByRole("button", { name: "Inspect progress and verify bytes" })
      .click();
    await expect(page.getByTestId("lifecycle-state")).toHaveText("stopped");
    await page.getByRole("button", { name: "Resume approved machine" }).click();
    await page
      .getByRole("button", { name: "Inspect progress and verify bytes" })
      .click();
    await expect(page.getByTestId("lifecycle-state")).toHaveText("running");
    await expect(page.getByTestId("persistence-state")).toHaveText(
      "Bytes verified",
    );
    await page.getByRole("button", { name: "Stop owned machine" }).click();
    await page
      .getByRole("button", { name: "Inspect progress and verify bytes" })
      .click();
    await expect(page.getByTestId("lifecycle-state")).toHaveText("stopped");
    await page.getByRole("button", { name: "Forks workflow" }).click();
    await page
      .getByRole("checkbox", {
        name: /I understand this creates a billable child/,
      })
      .check();
    await page.getByRole("button", { name: "Fork stopped source" }).click();
    await page.getByRole("button", { name: "Inspect original fork" }).click();
    await page.getByRole("button", { name: "Verify retained copy" }).click();
    await expect(page.getByTestId("fork-copy")).toHaveText("Copy bytes match");
    await page.getByRole("button", { name: "Cleanup workflow" }).click();
    await page.getByLabel("Type the exact run ID").fill("offline-run");
    await page
      .getByRole("button", { name: "Request next recorded deletion" })
      .click();
    await expect(page.getByTestId("cleanup-target").first()).toContainText(
      "fork / pending",
    );
    await expect(
      page.getByRole("heading", { name: "Cleanup remains unresolved" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Inspect original deletion" })
      .click();
    await page
      .getByRole("button", { name: "Request next recorded deletion" })
      .click();
    await page
      .getByRole("button", { name: "Inspect original deletion" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Known resource cleanup confirmed" }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("mounted-workflow-cleanup.png"),
      fullPage: true,
    });
    expect(backend.http.mutations.filter((r) => r.includes("DELETE"))).toEqual([
      "DELETE /api/v1/sandboxes/offline-child",
      "DELETE /api/v1/sandboxes/offline-parent",
    ]);
  } finally {
    try {
      browser.assertClean();
    } finally {
      await backend.close();
    }
  }
});
test("network trap", async ({ page }) => {
  const http = new SyntheticBoatHTTP();
  await expect(
    http.fetch("https://boat.dev/api/v1/sandboxes/unrecorded", {
      method: "DELETE",
    }),
  ).rejects.toThrow("Unexpected provider request");
  expect(() => http.assertClean()).toThrow("Unexpected provider request");
  const browser = await trapBrowserNetwork(page, origin);
  await page.goto(`${origin}/e2e/fixtures/workflows.html?access=loading`);
  await page.evaluate(() =>
    fetch("https://boat.dev/api/v1/unexpected").catch(() => null),
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const socket = new WebSocket("wss://boat.dev/unexpected");
        socket.onclose = () => resolve();
        socket.onerror = () => resolve();
      }),
  );
  expect(() => browser.assertClean()).toThrow("Unexpected browser request");
});
test("provider failure", async ({ page }, info) => {
  const backend = await createMountedBackend(),
    browser = await trapBrowserNetwork(page, origin);
  try {
    await backend.prepare();
    backend.http.failFileReads = true;
    await page.exposeFunction("workflowRpc", backend.rpc);
    await page.goto(`${origin}/e2e/fixtures/workflows.html?workflow=Files`);
    await page.getByRole("button", { name: "Read selected file" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "was not fully confirmed",
    );
    expect(backend.http.failureReplies).toBeGreaterThan(0);
    await expect(page.getByRole("alert")).not.toContainText(
      "synthetic native failure",
    );
    await page.screenshot({
      path: info.outputPath("native-file-failure.png"),
      fullPage: true,
    });
  } finally {
    try {
      browser.assertClean();
    } finally {
      await backend.close();
    }
  }
});

test("loading, missing configuration and denied access stay locked", async ({
  page,
}) => {
  const backend = await createMountedBackend(),
    browser = await trapBrowserNetwork(page, origin);
  try {
    await expect(backend.denied()).rejects.toThrow();
    await expect(backend.foreign()).rejects.toThrow();
    expect(backend.http.requests).toEqual([]);
    await page.goto(`${origin}/setup`);
    await expect(
      page.getByText(
        "Connect a managed local backend and configure a Clerk development",
        { exact: false },
      ),
    ).toBeVisible();
    await page.goto(`${origin}/e2e/fixtures/workflows.html?access=loading`);
    await expect(page.getByRole("status")).toHaveText(
      "Verifying your session with Convex…",
    );
    await page.goto(`${origin}/e2e/fixtures/workflows.html?access=forbidden`);
    await expect(
      page.getByText("Live actions are locked.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create workflow" }),
    ).toHaveCount(0);
    expect(backend.http.requests).toEqual([]);
  } finally {
    try {
      browser.assertClean();
    } finally {
      await backend.close();
    }
  }
});

test("checkout env files cannot configure the offline server", async () => {
  const directory = await mkdtemp(join(tmpdir(), "csb-offline-env-"));
  let isolated: ViteDevServer | undefined;
  try {
    await writeFile(
      join(directory, ".env.local"),
      "VITE_CONVEX_URL=https://synthetic.invalid\nVITE_CLERK_PUBLISHABLE_KEY=pk_test_synthetic\nVITE_SYNTHETIC_ENV_SENTINEL=must-not-load\n",
    );
    isolated = await createOfflineServer(directory);
    expect(isolated.config.env.VITE_CONVEX_URL).toBeUndefined();
    expect(isolated.config.env.VITE_CLERK_PUBLISHABLE_KEY).toBeUndefined();
    expect(isolated.config.env.VITE_SYNTHETIC_ENV_SENTINEL).toBeUndefined();
  } finally {
    await isolated?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
