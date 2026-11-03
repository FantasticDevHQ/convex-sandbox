import { spawnSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";

test("core, component config and generated references resolve from public package exports", async () => {
  const core = await import("@fantastic.dev/convex-sandbox");
  const config = await import("@fantastic.dev/convex-sandbox/convex.config.js");
  const testing = await import("@fantastic.dev/convex-sandbox/testing");
  await import("@fantastic.dev/convex-sandbox/_generated/component.js");
  assert.equal(typeof core.SandboxBoundary, "function");
  assert.ok(config.default);
  assert.equal(typeof testing.register, "function");
});

test("server helpers fail browser imports while Convex resolution remains available", () => {
  const browser = spawnSync(
    process.execPath,
    [
      "--conditions=browser",
      "--input-type=module",
      "-e",
      "await import('@fantastic.dev/convex-sandbox/server')",
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(browser.status, 0);
  assert.match(browser.stderr, /server-only/);
  const convex = spawnSync(
    process.execPath,
    [
      "--conditions=browser",
      "--conditions=convex",
      "--input-type=module",
      "-e",
      "const { createHostAccess } = await import('@fantastic.dev/convex-sandbox/server'); if (typeof createHostAccess !== 'function') process.exit(1)",
    ],
    { encoding: "utf8" },
  );
  assert.equal(convex.status, 0, convex.stderr);
});

test("core and testing entry graphs do not load React or test-runner runtime dependencies", () => {
  const code = `
    import { registerHooks } from "node:module";
    registerHooks({ resolve(specifier, context, next) {
      if (/^(react(?:$|\\/)|react-dom(?:$|\\/)|vitest(?:$|\\/)|convex-test(?:$|\\/))/.test(specifier)) throw new Error("Forbidden runtime dependency");
      const result = next(specifier, context);
      if (process.argv[2] === "core" && result.url.includes("/dist/testing/")) throw new Error("Core loaded test fixtures");
      return result;
    } });
    await import(process.argv[1]);
  `;
  for (const [entry, mode] of [
    ["@fantastic.dev/convex-sandbox", "core"],
    ["@fantastic.dev/convex-sandbox/testing", "testing"],
  ]) {
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", code, entry, mode],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
  }
});

test(
  "packed artifact works in an isolated offline consumer without workspace source",
  { timeout: 120000 },
  async (t) => {
    const { mkdtemp, readdir, readFile, writeFile, realpath, rm } =
      await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "sandbox-packed-consumer-")),
    );
    t.after(() => rm(root, { recursive: true, force: true }));
    const run = (command, args, cwd = root) => {
      const result = spawnSync(command, args, {
        cwd,
        encoding: "utf8",
        timeout: 60000,
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      return result.stdout;
    };
    run("pnpm", ["pack", "--pack-destination", root], process.cwd());
    const archives = (await readdir(root)).filter((name) =>
      name.endsWith(".tgz"),
    );
    assert.equal(archives.length, 1);
    const archive = join(root, archives[0]);
    const entries = run("tar", ["-tzf", archive]).trim().split("\n");
    assert.ok(entries.length > 20);
    for (const entry of entries)
      assert.match(
        entry,
        /^package\/(dist\/|docs\/|package\.json$|README\.md$|LICENSE$)/,
      );
    const manifest = JSON.parse(
      await readFile(join(process.cwd(), "package.json"), "utf8"),
    );
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "packed-sandbox-consumer",
        private: true,
        type: "module",
        packageManager: manifest.packageManager,
        dependencies: {
          "@fantastic.dev/convex-sandbox": `file:${archive}`,
          convex: manifest.devDependencies.convex,
        },
      }),
    );
    run("pnpm", [
      "install",
      "--offline",
      "--ignore-scripts",
      "--no-frozen-lockfile",
      "--config.auto-install-peers=false",
    ]);
    await writeFile(
      join(root, "verify.mjs"),
      `
    import assert from "node:assert/strict";
    import { realpath } from "node:fs/promises";
    import { fileURLToPath } from "node:url";
    import { SandboxProviders } from "@fantastic.dev/convex-sandbox";
    import config from "@fantastic.dev/convex-sandbox/convex.config.js";
    import "@fantastic.dev/convex-sandbox/_generated/component.js";
    import { createHostAccess } from "@fantastic.dev/convex-sandbox/server";
    import { createSimulatedProvider } from "@fantastic.dev/convex-sandbox/testing";
    const resolved = await realpath(fileURLToPath(import.meta.resolve("@fantastic.dev/convex-sandbox")));
    assert.ok(resolved.startsWith(process.cwd() + "/node_modules/"));
    assert.equal(typeof SandboxProviders, "function");
    assert.equal(typeof createHostAccess, "function");
    assert.ok(config);
    await assert.rejects(import("@fantastic.dev/convex-sandbox/dist/client/index.js"), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
    await assert.rejects(import("convex-test"), { code: "ERR_MODULE_NOT_FOUND" });
    let checkpoint;
    const fixture = createSimulatedProvider({ onChange: async state => { checkpoint = state; } });
    const context = { idempotencyKey: "packed-create", signal: new AbortController().signal };
    const created = await fixture.provider.adapter.create({}, context);
    const restored = createSimulatedProvider({ state: checkpoint });
    assert.equal((await restored.provider.adapter.findCreate("packed-create", context)).providerId, created.providerId);
    console.log("PASS: packed public exports, server helpers and durable simulator resolve outside the workspace without convex-test");
  `,
    );
    const output = run(process.execPath, ["verify.mjs"]);
    assert.match(output, /PASS: packed public exports/);
  },
);
