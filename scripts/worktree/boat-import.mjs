import path from "node:path";
import { homedir } from "node:os";
import { root, configFile, read } from "./context.mjs";
import { state, checkConfig } from "./config.mjs";
import { ownedRunning } from "./processes.mjs";
import { locked, projectLock } from "./registry.mjs";
import { readSharedBoatKey, writeBoatKey } from "./boat-config.mjs";

async function ownedTarget() {
  const s = await state();
  await checkConfig(s, true);
  if (!s.deployment?.startsWith("anonymous-") || !(await ownedRunning(s)))
    throw new Error(
      "Start this worktree's managed anonymous backend before importing.",
    );
  await locked(async (leases) => {
    const lease = leases[root];
    if (
      lease?.id !== s.id ||
      ["cloud", "site", "web"].some(
        (key) => lease.ports?.[key] !== s.ports[key],
      ) ||
      Object.entries(leases).some(
        ([checkout, value]) =>
          checkout !== root &&
          Object.values(value.ports).some((port) =>
            Object.values(s.ports).includes(port),
          ),
      )
    )
      throw new Error(
        "Refusing missing, changed or conflicting worktree reservation.",
      );
  });
  const config = await read(configFile, null);
  return { ...s, adminKey: config.adminKey };
}

export async function importBoatKey({ accessToken, managementFetch } = {}) {
  return projectLock(async () => {
    const before = await ownedTarget();
    if (accessToken === undefined) {
      try {
        accessToken =
          process.env.CONVEX_MANAGEMENT_ACCESS_TOKEN ||
          (await read(path.join(homedir(), ".convex/config.json"), null))
            ?.accessToken;
      } catch {
        throw new Error(
          "Cannot read Convex management authorization; details suppressed.",
        );
      }
    }
    const value = await readSharedBoatKey(accessToken, managementFetch);
    const target = await ownedTarget();
    if (
      target.id !== before.id ||
      target.deployment !== before.deployment ||
      target.adminKey !== before.adminKey ||
      ["cloud", "site", "web"].some(
        (key) => target.ports[key] !== before.ports[key],
      )
    )
      throw new Error(
        "Owned backend changed during credential read; import refused.",
      );
    await writeBoatKey(target, value);
    console.log(
      "Imported BOAT_API_KEY Development default into this owned anonymous backend. No Boat request was made.",
    );
  });
}
