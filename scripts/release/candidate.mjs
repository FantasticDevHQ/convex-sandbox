import {
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { candidateMetadata, validateArtifactPaths } from "./artifact.mjs";

const root = await realpath(process.cwd());
const output = process.argv[2];
if (!output || !path.isAbsolute(output))
  throw new Error(
    "Provide a new absolute output directory outside the checkout",
  );
const parent = await realpath(path.dirname(output));
const destination = path.join(parent, path.basename(output));
if (destination === root || destination.startsWith(root + path.sep))
  throw new Error("Candidate output must stay outside the checkout");
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
if (git("status", "--porcelain"))
  throw new Error("Commit source changes before preparing a candidate");
const sourceCommit = git("rev-parse", "HEAD");
const manifest = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const digest = (data) => createHash("sha256").update(data).digest("hex");
await mkdir(destination); // Refuse to overwrite an existing directory.
try {
  execFileSync("pnpm", ["pack", "--pack-destination", destination], {
    cwd: root,
    stdio: "pipe",
  });
  const names = (await readdir(destination)).filter((name) =>
    name.endsWith(".tgz"),
  );
  if (names.length !== 1) throw new Error("Expected one candidate tarball");
  const file = names[0],
    archive = path.join(destination, file);
  validateArtifactPaths(
    execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
      .trim()
      .split("\n"),
  );
  const contents = await readFile(archive);
  const metadata = candidateMetadata(manifest, {
    sourceCommit,
    file,
    bytes: contents.length,
    sha256: digest(contents),
    lockfileSha256: digest(await readFile(path.join(root, "pnpm-lock.yaml"))),
  });
  await writeFile(
    path.join(destination, "candidate.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
  await writeFile(
    path.join(destination, "SHA256SUMS"),
    `${metadata.artifact.sha256}  ${file}\n`,
  );
  console.log(
    `Prepared ${manifest.name}@${manifest.version}; source ${sourceCommit}; SHA256 ${metadata.artifact.sha256}`,
  );
  console.log(
    "No registry publication occurred. Verify required checks and workflow attestation separately.",
  );
} catch (error) {
  await rm(destination, { recursive: true, force: true });
  throw error;
}
