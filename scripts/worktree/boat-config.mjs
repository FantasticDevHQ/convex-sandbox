// Management reads and local writes deliberately use separate transports.
// Never include response bodies, credentials or transport errors in diagnostics.
const source = Object.freeze({
  id: 3397663,
  slug: "convex-sandbox",
  teamId: 419366,
  teamSlug: "fantastic-dev",
});

export async function readSharedBoatKey(accessToken, managementFetch = fetch) {
  if (typeof accessToken !== "string" || !accessToken.trim())
    throw new Error("Authenticated Convex management access is required.");
  const get = async (suffix) => {
    try {
      const response = await managementFetch(
        `https://api.convex.dev/v1/projects/${source.id}${suffix}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok) throw new Error();
      return await response.json();
    } catch {
      throw new Error(
        "Convex management read failed; response details suppressed.",
      );
    }
  };
  const project = await get("");
  if (
    !project ||
    Object.entries(source).some(([key, value]) => project[key] !== value)
  )
    throw new Error(
      "Refusing credential read outside the approved source team/project.",
    );
  const result = await get(
    "/list_default_environment_variables?name=BOAT_API_KEY&deploymentType=dev",
  );
  const items = result?.items;
  if (
    result?.pagination?.hasMore !== false ||
    !Array.isArray(items) ||
    items.length !== 1 ||
    items[0]?.name !== "BOAT_API_KEY" ||
    !Array.isArray(items[0].deploymentTypes) ||
    items[0].deploymentTypes.length !== 1 ||
    items[0].deploymentTypes[0] !== "dev" ||
    typeof items[0].value !== "string" ||
    !items[0].value.trim()
  )
    throw new Error("Expected exactly one BOAT_API_KEY Development default.");
  return items[0].value;
}

export async function writeBoatKey(target, value, localFetch = fetch) {
  const validPort = (port) =>
    Number.isInteger(port) && port > 0 && port <= 65535;
  if (
    !target?.deployment?.startsWith("anonymous-") ||
    !validPort(target.ports?.cloud) ||
    !validPort(target.ports?.site) ||
    target.ports.cloud === target.ports.site ||
    typeof target.adminKey !== "string" ||
    !target.adminKey ||
    typeof value !== "string" ||
    !value.trim()
  )
    throw new Error("Refusing invalid anonymous backend target or empty key.");
  try {
    const response = await localFetch(
      `http://127.0.0.1:${target.ports.cloud}/api/update_environment_variables`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Convex ${target.adminKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ changes: [{ name: "BOAT_API_KEY", value }] }),
      },
    );
    if (!response.ok) throw new Error();
  } catch {
    throw new Error(
      "Local key import failed; response details suppressed. Retry only after checking the owned backend.",
    );
  }
}
