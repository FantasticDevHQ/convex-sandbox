import { validateArtifactPaths } from "../scripts/release/artifact.mjs";
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

test("Boat entry resolves on the server and fails browser imports", async () => {
  const { createBoatProvider } = await import("@fantastic.dev/convex-sandbox/boat");
  assert.equal(typeof createBoatProvider, "function");
  for (const convex of [false, true]) {
    const result = spawnSync(process.execPath, [
      "--conditions=browser", ...(convex ? ["--conditions=convex"] : []),
      "--input-type=module", "-e",
      "await import('@fantastic.dev/convex-sandbox/boat')",
    ], { encoding: "utf8" });
    if (convex) assert.equal(result.status, 0, result.stderr);
    else { assert.notEqual(result.status, 0); assert.match(result.stderr, /server-only/); }
  }
});

test("core and testing entry graphs do not load React or test-runner runtime dependencies", () => {
  const code = `
    import { registerHooks } from "node:module";
    registerHooks({ resolve(specifier, context, next) {
      if (/^(@boatdev\\/sdk(?:$|\\/)|react(?:$|\\/)|react-dom(?:$|\\/)|vitest(?:$|\\/)|convex-test(?:$|\\/))/.test(specifier)) throw new Error("Forbidden runtime dependency");
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
    assert.ok(entries.includes("package/assets/brand/logo-mark.svg"));
    assert.ok(entries.includes("package/docs/quickstart.md"));
    assert.ok(entries.includes("package/docs/development.md"));
    validateArtifactPaths(entries);
    assert.ok(entries.includes("package/CHANGELOG.md"));
    assert.equal(
      run("tar", ["-xOzf", archive, "package/assets/brand/logo-mark.svg"]),
      await readFile(join(process.cwd(), "assets/brand/logo-mark.svg"), "utf8"),
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
    // A frozen source install caches package blobs, but not necessarily registry
    // metadata. Provision this consumer explicitly with a fresh metadata cache,
    // then prove a frozen offline reinstall without reusing node_modules.
    const install = [
      "install",
      "--ignore-scripts",
      "--config.auto-install-peers=false",
      `--config.cache-dir=${join(root, "pnpm-cache")}`,
    ];
    run("pnpm", [...install, "--no-frozen-lockfile"]);
    await rm(join(root, "node_modules"), { recursive: true, force: true });
    run("pnpm", [...install, "--offline", "--frozen-lockfile"]);
    await writeFile(
      join(root, "verify.mjs"),
      `
    import assert from "node:assert/strict";
    import { realpath } from "node:fs/promises";
    import { fileURLToPath } from "node:url";
    import { SandboxProviders, normalizeDesktopSession, defineCapabilities } from "@fantastic.dev/convex-sandbox";
    import config from "@fantastic.dev/convex-sandbox/convex.config.js";
    import "@fantastic.dev/convex-sandbox/_generated/component.js";
    import { createHostAccess } from "@fantastic.dev/convex-sandbox/server";
    import { createSimulatedProvider } from "@fantastic.dev/convex-sandbox/testing";
    const resolved = await realpath(fileURLToPath(import.meta.resolve("@fantastic.dev/convex-sandbox")));
    assert.ok(resolved.startsWith(process.cwd() + "/node_modules/"));
    assert.equal(typeof SandboxProviders, "function");
    const desktop = normalizeDesktopSession({kind:'desktop',url:'https://desktop.example/stream.html#token=synthetic',connectionWindow:{durationMs:600000,basis:'provider-issued'},activeStream:'may-outlive-connection-window',disconnect:'no-revocation-guarantee'});
    assert.equal(desktop.activeStream, 'may-outlive-connection-window');
    assert.equal(Object.hasOwn(desktop, 'expiresAt'), false);
    assert.deepEqual(defineCapabilities({version:1,supported:['getDesktopSession']}).supported,['getDesktopSession']);
    assert.equal(typeof createHostAccess, "function");
    assert.ok(config);
    await assert.rejects(import("@fantastic.dev/convex-sandbox/dist/client/index.js"), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
    await assert.rejects(import("convex-test"), { code: "ERR_MODULE_NOT_FOUND" });
    let checkpoint;
    const fixture = createSimulatedProvider({ onChange: async state => { checkpoint = state; } });
    const context = { idempotencyKey: "packed-create", signal: new AbortController().signal };
    const created = await fixture.provider.adapter.create({}, context);
    const providers = new SandboxProviders({ authorize: async () => {} });
    providers.register(fixture.provider);
    assert.equal((await providers.describe({ sandbox: { scope: "packed-fixture", key: "machine" }, reference: { provider: fixture.provider.name, providerId: created.providerId } })).state, "running");
    const restored = createSimulatedProvider({ state: checkpoint });
    assert.equal((await restored.provider.adapter.findCreate("packed-create", context)).providerId, created.providerId);
    console.log("PASS: packed public exports, server helpers and durable simulator resolve outside the workspace without convex-test");
  `,
    );
    const output = run(process.execPath, ["verify.mjs"]);
    assert.match(output, /PASS: packed public exports/);
    run(process.execPath, ["--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      await assert.rejects(import('@fantastic.dev/convex-sandbox/boat'), error => error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes('@boatdev/sdk'));
    `]);
    const consumer = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    consumer.dependencies["@boatdev/sdk"] = manifest.devDependencies["@boatdev/sdk"];
    await writeFile(join(root, "package.json"), JSON.stringify(consumer));
    run("pnpm", [...install, "--no-frozen-lockfile"]);
    run(process.execPath, ["--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      import { createBoatProvider } from '@fantastic.dev/convex-sandbox/boat';
      const boat = createBoatProvider({apiKey:'synthetic-packed-key',fetch:async()=>new Response(JSON.stringify({ok:true,sandbox:{id:'packed-vm',state:'ready'}}))});
      assert.equal((await boat.adapter.describe('packed-vm')).state,'running');
      console.log('PASS: packed optional Boat entry uses injected HTTP after exact SDK installation');
    `]);
    await writeFile(join(root, "verify.ts"), `
      import { createBoatProvider, createBoatWebhookHandler, type BoatOptions, type BoatWebhookOptions } from '@fantastic.dev/convex-sandbox/boat';
      import { normalizeDesktopSession, type DesktopSession, type DesktopSessionAdapter, type Capability, SandboxProviders, type ProviderRegistration } from '@fantastic.dev/convex-sandbox';
      const desktop: DesktopSession = normalizeDesktopSession({
        kind:'desktop', url:'https://desktop.example/stream.html#token=synthetic',
        connectionWindow:{durationMs:600000,basis:'provider-issued'},
        activeStream:'may-outlive-connection-window',disconnect:'no-revocation-guarantee',
      });
      const desktopAdapter: DesktopSessionAdapter = {get:async()=>desktop};
      const desktopCapability: Capability = 'getDesktopSession';
      // @ts-expect-error Native sessions do not claim a full access expiration.
      const inventedExpiry: number = desktop.expiresAt;
      const webhook: BoatWebhookOptions = {
        accountId:'test-account', endpointId:'test-endpoint', signingKeys:[new TextEncoder().encode('synthetic-packed-webhook-key')],
        timestampUnit:'seconds', maxAgeMs:300000, maxFutureSkewMs:30000,
        enqueueRefresh:async(hint,context)=>{ const provider:'boat'=hint.provider; context.signal.throwIfAborted(); return 'ignored'; },
      };
      const handler:(request:Request)=>Promise<Response>=createBoatWebhookHandler(webhook);
      const options: BoatOptions = {apiKey:'synthetic-types-key',ttlSeconds:60};
      const provider: ProviderRegistration = createBoatProvider(options);
      new SandboxProviders({authorize:async()=>{}}).register(provider);
    `);
    run(process.execPath, [join(process.cwd(), "node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--skipLibCheck", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "verify.ts"]);

  },
);
