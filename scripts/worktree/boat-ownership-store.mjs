import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

async function noLinks(file) {
  let current = path.parse(path.resolve(file)).root;
  for (const part of path.resolve(file).slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    try {
      if ((await fs.lstat(current)).isSymbolicLink())
        throw Error("Ownership index refuses symlinks");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
function location(directory, id) {
  if (!path.isAbsolute(directory) || !/^[a-zA-Z0-9_-]{1,100}$/.test(id))
    throw Error("Invalid ownership location");
  return path.join(directory, `${id}.json`);
}
export async function readOwnership(directory, id) {
  const file = location(directory, id);
  await noLinks(file);
  return JSON.parse(await fs.readFile(file, "utf8"));
}
function text(value) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 1024 ||
    /[\x00-\x1f]/.test(value)
  )
    throw Error("Invalid ownership identity");
  return value;
}
/** Recovery export only. This module has no provider APIs, lifecycle or deletion authority. */
export async function retainOwnership(owner, input, binding = {}) {
  const file = location(owner.directory, owner.id);
  if (
    !path.isAbsolute(owner.root) ||
    !owner.deployment?.startsWith("anonymous-")
  )
    throw Error("Anonymous worktree required");
  const relative = path.relative(owner.root, owner.directory);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".."))
    throw Error("Recovery index must be outside checkout");
  await noLinks(path.join(owner.root, ".worktree/local.json"));
  await noLinks(file);
  const state = JSON.parse(
    await fs.readFile(path.join(owner.root, ".worktree/local.json"), "utf8"),
  );
  if (
    !Number.isInteger(owner.cloudPort) ||
    state.ports?.cloud !== owner.cloudPort ||
    state.version !== 1 ||
    state.id !== owner.id ||
    state.root !== owner.root ||
    state.deployment !== owner.deployment
  )
    throw Error("Foreign worktree identity");
  // Explicit projection: never serialize caller objects, credentials, fixtures or native payloads.
  const intent = Object.fromEntries(
    [
      "scope",
      "runId",
      "operationId",
      "reservationId",
      "key",
      "accountId",
      "wallet",
    ].map((key) => [key, text(input[key])]),
  );
  if (!["create", "fork"].includes(input.kind))
    throw Error("Invalid creation kind");
  Object.assign(intent, {
    kind: input.kind,
    walletTeamId: input.walletTeamId === null ? null : text(input.walletTeamId),
    parent:
      input.parent === null
        ? null
        : {
            key: text(input.parent.key),
            nativeId: text(input.parent.nativeId),
            generation: input.parent.generation,
          },
  });
  if (
    (input.kind === "fork") !== (intent.parent !== null) ||
    (intent.parent &&
      (!Number.isSafeInteger(intent.parent.generation) ||
        intent.parent.generation < 1))
  )
    throw Error("Invalid parent dependency");
  const nativeId =
    binding.nativeId === undefined ? null : text(binding.nativeId);
  const generation = binding.generation ?? null;
  if (
    generation !== null &&
    (!Number.isSafeInteger(generation) || generation < 1)
  )
    throw Error("Invalid binding generation");
  await fs.mkdir(owner.directory, { recursive: true, mode: 0o700 });
  const lock = `${file}.lock`;
  // Never steal a lock on a timer. An interrupted writer fails closed for explicit recovery.
  const deadline = Date.now() + 5000;
  while (true) {
    try {
      await fs.mkdir(lock, { mode: 0o700 });
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() >= deadline)
        throw Error("Ownership index locked; inspect interrupted writer");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  let temporary;
  try {
    await noLinks(file);
    let data;
    try {
      data = await readOwnership(owner.directory, owner.id);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const identity = {
      id: owner.id,
      root: owner.root,
      deployment: owner.deployment,
      cloudPort: owner.cloudPort,
    };
    data ??= { version: 1, owner: identity, intents: [] };
    if (
      data.version !== 1 ||
      JSON.stringify(data.owner) !== JSON.stringify(identity) ||
      !Array.isArray(data.intents)
    )
      throw Error("Foreign ownership index");
    const old = data.intents.find(
      (row) =>
        row.scope === intent.scope &&
        row.runId === intent.runId &&
        row.operationId === intent.operationId,
    );
    if (old) {
      for (const key of Object.keys(intent))
        if (JSON.stringify(old[key]) !== JSON.stringify(intent[key]))
          throw Error("Original ownership intent changed");
      if (
        (nativeId && old.nativeId && nativeId !== old.nativeId) ||
        (generation && old.generation && generation !== old.generation)
      )
        throw Error("Original native binding changed");
      old.nativeId ??= nativeId;
      old.generation ??= generation;
      old.outcome = old.nativeId ? "identified" : "unknown";
    } else
      data.intents.push({
        ...intent,
        nativeId,
        generation,
        outcome: nativeId ? "identified" : "unknown",
      });
    temporary = `${file}.${randomUUID()}.tmp`;
    const handle = await fs.open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(data, null, 2)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, file);
    const directory = await fs.open(owner.directory, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    return data;
  } finally {
    if (temporary) await fs.rm(temporary, { force: true });
    await fs.rmdir(lock);
  }
}
