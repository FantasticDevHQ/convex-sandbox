import { test, expect } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { execFileSync } from "node:child_process";
declare global {
  interface Window {
    recoveryInspections?: number;
  }
}
let server: ViteDevServer | undefined, origin: string;
const root = process.env.CSB_RECOVERY_ROOT;
test.beforeAll(async () => {
  if (process.env.CSB_LIVE_URL) {
    origin = process.env.CSB_LIVE_URL;
    return;
  }
  server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
  await server.listen();
  const a = server.httpServer?.address();
  if (!a || typeof a === "string") throw Error("No address");
  origin = `http://127.0.0.1:${a.port}`;
});
test.afterAll(async () => {
  await server?.close();
});
test("opening unknown work never inspects or replays automatically", async ({
  page,
}, info) => {
  await page.goto(`${origin}/e2e/fixtures/recovery.html`);
  await expect(page.getByTestId("retained-operation")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Inspect original operation" }).nth(1),
  ).toBeDisabled();
  expect(await page.evaluate(() => window.recoveryInspections ?? 0)).toBe(0);
  await page.reload();
  await expect(page.getByText("fork-original", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.recoveryInspections ?? 0)).toBe(0);
  await page
    .getByRole("button", { name: "Inspect original operation" })
    .first()
    .click();
  expect(await page.evaluate(() => window.recoveryInspections)).toBe(1);
  await page.screenshot({
    path: info.outputPath("operations-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("operations-mobile.png"),
    fullPage: true,
  });
});
test("historical binding cannot be inspected", async ({ page }) => {
  await page.goto(`${origin}/e2e/fixtures/recovery.html?stale=1`);
  for (const button of await page
    .getByRole("button", { name: "Inspect original operation" })
    .all())
    await expect(button).toBeDisabled();
  await expect(
    page.getByText("Historical binding.", { exact: false }).first(),
  ).toBeVisible();
});
function rpc(fn: string, args: unknown) {
  if (!root) throw Error("Owned checkout required");
  const code = `import {spawnSync} from "node:child_process";import path from "node:path";import {state,checkConfig,childEnv,cli} from "./scripts/worktree/config.mjs";import {backend,dir} from "./scripts/worktree/context.mjs";const s=await state();await checkConfig(s,true);const r=spawnSync(process.execPath,[cli(),"run","--env-file",path.join(dir,"convex.env"),"--component","sandbox",process.argv[1],process.argv[2]],{cwd:backend,env:childEnv(s),encoding:"utf8"});if(r.status!==0)throw Error(r.stderr.slice(-2000));process.stdout.write(JSON.stringify(JSON.parse(r.stdout)));`;
  return JSON.parse(
    execFileSync(
      process.execPath,
      ["--input-type=module", "-e", code, fn, JSON.stringify(args)],
      { cwd: root, encoding: "utf8", timeout: 30000 },
    ),
  );
}
test("backend restart", async ({ page }, info) => {
  test.skip(
    !root,
    "Actual managed restart runs in UbiCloud worktree qualification.",
  );
  test.setTimeout(120000);
  const sandbox = {
    scope: "recovery-browser-qualification",
    key: `restart-${Date.now()}`,
  };
  const binding = rpc("registry:ensure", {
    sandbox,
    reference: { provider: "boat", providerId: "synthetic-retained-native" },
  });
  const op = rpc("operations:begin", {
    sandbox,
    expectedVersion: binding.version,
    operationId: "stop-before-restart",
    kind: "stop",
  });
  await page.exposeFunction("readRecovery", () => ({
    key: sandbox.key,
    context: {
      row: rpc("registry:get", { sandbox }),
      provision: null,
      admissions: [],
      admissionsTruncated: false,
      forkSource: null,
    },
    operations: rpc("operations:list", {
      sandbox,
      paginationOpts: { cursor: null, numItems: 20 },
    }).page,
  }));
  await page.goto(`${origin}/e2e/fixtures/recovery.html`);
  await expect(page.getByText(op.operationId, { exact: true })).toBeVisible();
  for (const args of [["stop"], ["start", "--frontend"]])
    execFileSync(process.execPath, ["scripts/worktree/cli.mjs", ...args], {
      cwd: root,
      env: { ...process.env, CI: "true" },
      timeout: 60000,
      stdio: "pipe",
    });
  await page.reload();
  await expect(page.getByText(op.operationId, { exact: true })).toBeVisible();
  await expect(page.getByTestId("retained-operation")).toContainText(
    "stop / pending",
  );
  expect(
    rpc("operations:get", { sandbox, operationId: op.operationId }),
  ).toEqual(op);
  await page.screenshot({
    path: info.outputPath("backend-restart.png"),
    fullPage: true,
  });
});

test("live route requires verified operator access", async ({ page }, info) => {
  await page.goto(`${origin}/operations?machine=research-one`);
  await expect(
    page.getByRole("heading", { name: "Operations", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Connect a managed local backend and configure a Clerk development", {
      exact: false,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("operations-access-gate.png"),
    fullPage: true,
  });
});
