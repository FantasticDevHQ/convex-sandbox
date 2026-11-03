import { packageBin } from "./dependencies.mjs";

export function frontendArgs(port, layout, directories) {
  if (layout.frontend === false)
    throw new Error("Frontend is disabled in the worktree configuration.");
  const runtime = layout.frontendRuntime ?? "next";
  if (runtime === "vite")
    return [
      packageBin("vite", "vite", directories),
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ];
  if (runtime === "next")
    return [
      packageBin("next", "next", directories),
      "dev",
      "--port",
      String(port),
    ];
  throw new Error(`Unsupported frontend runtime: ${runtime}`);
}
