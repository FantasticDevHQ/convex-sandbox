// Only the two-worktree harness calls this with its freshly created checkout.
import {
  lstat,
  mkdtemp,
  mkdir,
  readdir,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { validateArtifactPaths } from "./artifact.mjs";

export async function mountPackedComponent(checkout, ownedParent) {
  const root = await realpath(checkout);
  if (!root.startsWith((await realpath(ownedParent)) + path.sep))
    throw new Error(
      "Packed host must be inside the owned qualification directory",
    );
  const link = path.join(
    root,
    "example/node_modules/@fantastic.dev/convex-sandbox",
  );
  if (!(await lstat(link)).isSymbolicLink() || (await realpath(link)) !== root)
    throw new Error("Expected this owned checkout's workspace dependency link");
  const directory = await mkdtemp(path.join(ownedParent, "packed-component-"));
  execFileSync("pnpm", ["build:lib"], { cwd: root, stdio: "pipe" });
  execFileSync("pnpm", ["pack", "--pack-destination", directory], {
    cwd: root,
    stdio: "pipe",
  });
  const names = (await readdir(directory)).filter((name) =>
    name.endsWith(".tgz"),
  );
  if (names.length !== 1) throw new Error("Expected one packed component");
  const archive = path.join(directory, names[0]);
  validateArtifactPaths(
    execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
      .trim()
      .split("\n"),
  );
  const extracted = path.join(directory, "extracted");
  await mkdir(extracted);
  execFileSync("tar", ["-xzf", archive, "-C", extracted]);
  const packaged = path.join(extracted, "package");
  await symlink(
    path.join(root, "node_modules"),
    path.join(packaged, "node_modules"),
    "dir",
  );
  await rm(link); // Remove only the validated dependency symlink, never its target.
  await symlink(packaged, link, "dir");
  if ((await realpath(link)) === root)
    throw new Error("Packed fixture still resolves workspace source");
}
