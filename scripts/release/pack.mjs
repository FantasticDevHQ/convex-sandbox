import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { validateArtifactPaths } from "./artifact.mjs";
/** Call only with a newly owned qualification directory. Never publishes or installs. */
export async function packAndExtract(source, directory) {
  await mkdir(directory);
  execFileSync("pnpm", ["build:lib"], {
    cwd: source,
    stdio: "pipe",
    timeout: 60000,
  });
  execFileSync("pnpm", ["pack", "--pack-destination", directory], {
    cwd: source,
    stdio: "pipe",
    timeout: 60000,
  });
  const names = (await readdir(directory)).filter((name) =>
    name.endsWith(".tgz"),
  );
  if (names.length !== 1) throw Error("Expected one packed component");
  const archive = path.join(directory, names[0]),
    entries = execFileSync("tar", ["-tzf", archive], {
      encoding: "utf8",
      timeout: 60000,
    })
      .trim()
      .split("\n");
  validateArtifactPaths(entries);
  const extracted = path.join(directory, "extracted");
  await mkdir(extracted);
  execFileSync("tar", ["-xzf", archive, "-C", extracted], { timeout: 60000 });
  return { archive, packaged: path.join(extracted, "package"), entries };
}
