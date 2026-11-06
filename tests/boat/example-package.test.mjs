import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  cp,
  mkdir,
  readFile,
  writeFile,
  realpath,
  symlink,
  rm,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { packAndExtract } from "../../scripts/release/pack.mjs";
const source = await realpath(process.cwd());
function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 60000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}
async function peer(name) {
  for (const location of [
    path.join(source, "example/node_modules", name),
    path.join(source, "node_modules", name),
  ]) {
    try {
      const target = await realpath(location),
        manifest = JSON.parse(
          await readFile(path.join(target, "package.json"), "utf8"),
        );
      if (manifest.name === name) return target;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  throw Error(
    `Install the declared peer/tool before packed app qualification: ${name}`,
  );
}
test(
  "packed app builds from public exports without component workspace source",
  { timeout: 120000 },
  async (t) => {
    const root = await realpath(
      await mkdtemp(path.join(tmpdir(), "sandbox-packed-app-")),
    );
    t.after(() => rm(root, { recursive: true, force: true }));
    const packed = await packAndExtract(source, path.join(root, "artifact")),
      consumer = path.join(root, "consumer"),
      app = path.join(consumer, "example");
    await mkdir(app, { recursive: true });
    for (const directory of ["src", "shared", "convex", "fixtures"])
      await cp(
        path.join(source, "example", directory),
        path.join(app, directory),
        {
          recursive: true,
          filter: (file) =>
            !path.basename(file).startsWith(".") && !file.endsWith(".test.ts"),
        },
      );
    for (const file of ["index.html", "vite.config.ts"])
      await cp(path.join(source, "example", file), path.join(app, file));
    await mkdir(path.join(consumer, "assets/brand"), { recursive: true });
    await cp(
      path.join(source, "assets/brand/logo-mark.svg"),
      path.join(consumer, "assets/brand/logo-mark.svg"),
    );
    const original = JSON.parse(
      await readFile(path.join(source, "example/package.json"), "utf8"),
    );
    const rootManifest = JSON.parse(
      await readFile(path.join(source, "package.json"), "utf8"),
    );
    const runtime = {
      ...original.dependencies,
      "@fantastic.dev/convex-sandbox": `file:${packed.archive}`,
      "@boatdev/sdk": rootManifest.peerDependencies["@boatdev/sdk"],
    };
    const tools = Object.fromEntries(
      ["vite", "@vitejs/plugin-react", "@types/react", "@types/react-dom"].map(
        (name) => [name, original.devDependencies[name]],
      ),
    );
    Object.assign(tools, {
      typescript: rootManifest.devDependencies.typescript,
      "@types/node": rootManifest.devDependencies["@types/node"],
    });
    await writeFile(
      path.join(consumer, "package.json"),
      JSON.stringify({
        name: "packed-example-consumer",
        private: true,
        type: "module",
        packageManager: rootManifest.packageManager,
        dependencies: runtime,
        devDependencies: tools,
      }),
    );
    await mkdir(path.join(consumer, "scripts/boat"), { recursive: true });
    for (const file of ["sdk-probe.ts", "transport-probe.ts"])
      await cp(
        path.join(source, "scripts/boat", file),
        path.join(consumer, "scripts/boat", file),
      );
    const rootOptions = JSON.parse(
      await readFile(path.join(source, "tsconfig.json"), "utf8"),
    ).compilerOptions;
    await writeFile(
      path.join(app, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          ...rootOptions,
          types: ["vite/client", "node"],
          jsx: "react-jsx",
        },
        include: [
          "src/**/*.ts",
          "src/**/*.tsx",
          "convex/**/*.ts",
          "vite.config.ts",
        ],
      }),
    );
    const modules = path.join(consumer, "node_modules");
    await mkdir(path.join(modules, "@fantastic.dev"), { recursive: true });
    const packageRoot = path.join(modules, "@fantastic.dev/convex-sandbox");
    await cp(packed.packaged, packageRoot, { recursive: true });
    const peers = [...Object.keys(runtime), ...Object.keys(tools)].filter(
      (name) => name !== "@fantastic.dev/convex-sandbox",
    );
    for (const name of peers) {
      const link = path.join(modules, name);
      await mkdir(path.dirname(link), { recursive: true });
      await symlink(await peer(name), link, "dir");
    }
    await assert.rejects(access(path.join(consumer, "src")));
    await assert.rejects(access(path.join(packageRoot, "src")));
    await assert.rejects(access(path.join(app, ".env.local")));
    const resolve = run(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import {realpath} from 'node:fs/promises';import {fileURLToPath} from 'node:url';for(const suffix of ['', '/boat', '/server', '/testing', '/convex.config.js'])console.log(await realpath(fileURLToPath(import.meta.resolve('@fantastic.dev/convex-sandbox'+suffix))));`,
      ],
      consumer,
    )
      .trim()
      .split("\n");
    assert.ok(
      resolve.every((file) => file.startsWith(packageRoot + path.sep)),
      "All public entries must resolve to the copied tarball",
    );
    const compiler = path.join(await peer("typescript"), "bin/tsc"),
      vite = path.join(await peer("vite"), "bin/vite.js");
    run(
      process.execPath,
      [compiler, "--noEmit", "-p", path.join(app, "tsconfig.json")],
      app,
    );
    run(process.execPath, [vite, "build"], app);
    await access(path.join(app, "dist/index.html"));
    console.log(
      "PASS: fresh packed app compiles and builds all runtime frontend/backend modules using copied public exports, with no component workspace source or environment state",
    );
    const manifestPath = path.join(packageRoot, "package.json"),
      manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.exports["."] = "./absent-public-export.js";
    await writeFile(manifestPath, JSON.stringify(manifest));
    const broken = spawnSync(
      process.execPath,
      [compiler, "--noEmit", "-p", path.join(app, "tsconfig.json")],
      { cwd: app, encoding: "utf8", timeout: 60000 },
    );
    assert.notEqual(broken.status, 0);
    assert.match(
      broken.stdout + broken.stderr,
      /@fantastic.dev\/convex-sandbox/,
    );
    console.log(
      "PASS: removing a packed public export fails the consumer instead of falling back to workspace source",
    );
  },
);
