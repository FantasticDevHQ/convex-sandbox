import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
/** Synthetic host ownership only; never copies checkout backend data or credentials. */
export async function worktreeOwnershipFixture() {
  const directory = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "csb-owner-")),
  );
  const owner = {
    id: randomUUID(),
    root: path.join(directory, "checkout"),
    deployment: "anonymous-synthetic",
    cloudPort: 19999,
    directory: path.join(directory, "index"),
  };
  await fs.mkdir(path.join(owner.root, ".worktree"), { recursive: true });
  await fs.writeFile(
    path.join(owner.root, ".worktree/local.json"),
    JSON.stringify({ version: 1, ...owner, ports: { cloud: owner.cloudPort } }),
  );
  return {
    owner,
    cleanup: () => fs.rm(directory, { recursive: true, force: true }),
  };
}
