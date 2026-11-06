import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { validateArtifactPaths } from "./artifact.mjs";
/** Packaging/build children need no provider, hosted-auth or deployment credentials. */
export function offlinePackageEnv(base = process.env) {
  return Object.fromEntries(
    Object.entries(base).filter(
      ([name]) =>
        !/^VITE_|^EXAMPLE_|BOAT|CLERK|SECRET|TOKEN|PASSWORD|PRIVATE_KEY|DEPLOY_KEY|ADMIN_KEY|^CONVEX_/i.test(
          name,
        ),
    ),
  );
}
/** Call only with a newly owned qualification directory. Never publishes or installs. */
export async function packAndExtract(source, directory) {
  await mkdir(directory);
  execFileSync("pnpm", ["build:lib"], {
    cwd: source,
    stdio: "pipe",
    timeout: 60000,
    env: offlinePackageEnv(),
  });
  execFileSync("pnpm", ["pack", "--pack-destination", directory], {
    cwd: source,
    stdio: "pipe",
    timeout: 60000,
    env: offlinePackageEnv(),
  });
  const names = (await readdir(directory)).filter((name) =>
    name.endsWith(".tgz"),
  );
  if (names.length !== 1) throw Error("Expected one packed component");
  const archive = path.join(directory, names[0]),
    entries = execFileSync("tar", ["-tzf", archive], {
      encoding: "utf8",
      timeout: 60000,
      env: offlinePackageEnv(),
    })
      .trim()
      .split("\n");
  validateArtifactPaths(entries);
  const extracted = path.join(directory, "extracted");
  await mkdir(extracted);
  execFileSync("tar", ["-xzf", archive, "-C", extracted], { timeout: 60000 });
  return { archive, packaged: path.join(extracted, "package"), entries };
}
