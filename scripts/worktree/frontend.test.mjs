import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { frontendArgs } from "./frontend.mjs";

async function fixture(t, name) {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "sandbox-frontend-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const pkg = path.join(root, "node_modules", name);
  await mkdir(pkg, { recursive: true });
  await writeFile(path.join(root, "package.json"), "{}");
  await writeFile(
    path.join(pkg, "package.json"),
    JSON.stringify({ name, bin: { [name]: "cli.mjs" } }),
  );
  await writeFile(path.join(pkg, "cli.mjs"), "export {};");
  return { root, bin: path.join(pkg, "cli.mjs") };
}

test("Vite binds the reserved loopback port and refuses automatic port fallback", async (t) => {
  const f = await fixture(t, "vite");
  assert.deepEqual(
    frontendArgs(18021, { frontend: "example", frontendRuntime: "vite" }, [
      f.root,
    ]),
    [f.bin, "--host", "127.0.0.1", "--port", "18021", "--strictPort"],
  );
});
test("default Next adapter remains compatible with upstream fixtures", async (t) => {
  const f = await fixture(t, "next");
  assert.deepEqual(frontendArgs(18021, {}, [f.root]), [
    f.bin,
    "dev",
    "--port",
    "18021",
  ]);
});
test("disabled or unsupported frontends fail before resolving a CLI", () => {
  assert.throws(() => frontendArgs(18021, { frontend: false }, []), /disabled/);
  assert.throws(
    () => frontendArgs(18021, { frontendRuntime: "unknown" }, []),
    /Unsupported frontend/,
  );
});
