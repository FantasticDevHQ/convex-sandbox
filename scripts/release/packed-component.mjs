// Only the two-worktree harness calls this with its freshly created checkout.
import { lstat, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { packAndExtract } from "./pack.mjs";

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
  const { packaged } = await packAndExtract(
    root,
    path.join(directory, "artifact"),
  );
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
