import { ConvexReactClient } from "convex/react";

function localUrl(value: string | undefined) {
  try {
    const url = new URL(value ?? "");
    if (
      ["http:", "https:"].includes(url.protocol) &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
      return url.origin;
  } catch {
    /* A standalone frontend needs no backend. */
  }
  return null;
}
export const backendUrl = localUrl(import.meta.env.VITE_CONVEX_URL);
export const backendClient = backendUrl
  ? new ConvexReactClient(backendUrl)
  : null;
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    void backendClient?.close();
  });
