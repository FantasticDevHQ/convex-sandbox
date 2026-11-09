#!/usr/bin/env node
// Keep all unexpected exceptions out of CLI output, including parser/transport data.
try {
  if (process.argv.length !== 2) throw new Error();
  const { importBoatKey } = await import("./boat-import.mjs");
  await importBoatKey();
} catch {
  console.error(
    "Boat key import refused or failed. Check managed setup/start, ownership, management authorization and approved Development default. Secret details suppressed.",
  );
  process.exitCode = 1;
}
