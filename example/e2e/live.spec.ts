import { expect, test } from "@playwright/test";

test("real local playground walkthrough, recovery and narrow layout", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const origin = process.env.CSB_LIVE_URL;
  if (!origin) throw new Error("Run inside owned worktree qualification");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/playground`);
  await expect(
    page.getByRole("heading", { name: "No demo machines yet" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create demo machines" }).click();
  await page
    .getByRole("link", { name: /persistent simulated-persistent running/ })
    .click();
  await expect(page).toHaveURL(/\/playground\/persistent$/);
  await expect(
    page.getByRole("heading", { name: "persistent", exact: true }),
  ).toBeVisible();
  const output = page.getByRole("textbox", { name: "Command output" });
  const run = page.getByRole("button", { name: "Run fixture", exact: true });
  await run.click();
  await expect(output).toHaveValue("Hello from convex-sandbox.\n");
  await page.getByLabel("Command scenario").selectOption("large-output");
  await run.click();
  await expect(page.getByRole("button", { name: "Next output" })).toBeEnabled();
  await page.getByRole("button", { name: "Next output" }).click();
  await expect(page.getByText(/Page 2/)).toBeVisible();
  await page.getByRole("button", { name: "Previous output" }).click();
  await expect(page.getByText(/Page 1/)).toBeVisible();
  await page.getByLabel("Command scenario").selectOption("lost-reply");
  await run.click();
  await expect(
    page.getByText("The reply was lost.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Check execution" }).click();
  await expect(output).toHaveValue("Hello from convex-sandbox.\n");
  await page.getByLabel("Command scenario").selectOption("background");
  await run.click();
  await page.getByRole("button", { name: "Cancel execution" }).click();
  await expect(page.getByText(/Cancellation: accepted/)).toBeVisible();
  await page.getByRole("button", { name: "Check execution" }).click();
  await expect(page.locator(".execution-summary strong")).toHaveText(
    "cancelled",
  );
  await page.getByLabel("File contents").fill("synthetic browser fixture");
  await page.getByRole("button", { name: "Write file", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "/workspace/note.txt", exact: true }),
  ).toBeVisible();
  await page.getByLabel("File contents").fill("");
  await page.getByRole("button", { name: "Read file", exact: true }).click();
  await expect(page.getByLabel("File contents")).toHaveValue(
    "synthetic browser fixture",
  );
  await page.getByLabel("File path").fill("/private/note.txt");
  await page.getByRole("button", { name: "Write file", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Denied");
  await page.getByRole("button", { name: "Dismiss" }).click();
  await page.getByLabel("File path").fill("/workspace/note.txt");
  await page
    .getByRole("button", { name: "Create snapshot", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Check snapshot", exact: true })
    .click();
  await expect(
    page.getByText("Snapshot: succeeded", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Get preview handle" }).click();
  await expect(
    page.getByRole("region", { name: "Nonfunctional connection handle" }),
  ).toContainText('"functional": false');
  await page.getByRole("button", { name: "Stop / pause" }).click();
  await expect(page.locator(".state-pill")).toHaveText("stopped");
  await expect(run).toBeDisabled();
  await page.getByRole("button", { name: "Start / resume" }).click();
  await expect(page.locator(".state-pill")).toHaveText("running");
  await page.getByRole("button", { name: "Read file", exact: true }).click();
  await expect(page.getByLabel("File contents")).toHaveValue(
    "synthetic browser fixture",
  );
  await page
    .getByRole("heading", { name: "persistent", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("playground-desktop.png"),
    fullPage: true,
  });
  await page
    .getByRole("link", { name: /ephemeral simulated-ephemeral running/ })
    .click();
  await expect(
    page.getByRole("button", { name: "Create snapshot", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText(
      "Unsupported: this profile does not advertise disk snapshots.",
    ),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("link", { name: /memory simulated-memory running/ })
    .click();
  await page.getByRole("button", { name: "Stop / pause" }).click();
  await expect(page.locator(".state-pill")).toHaveText("paused");
  await page.getByRole("button", { name: "Start / resume" }).click();
  await expect(page.locator(".state-pill")).toHaveText("running");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("playground-mobile.png"),
    fullPage: true,
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "memory", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: /persistent simulated-persistent running/ })
    .click();
  await page
    .getByRole("button", { name: "Delete machine", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm delete", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "persistent is deleted" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
