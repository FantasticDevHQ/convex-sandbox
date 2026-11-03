import { Component, type ReactNode } from "react";
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
const url = localUrl(import.meta.env.VITE_CONVEX_URL);
export const backendClient = url ? new ConvexReactClient(url) : null;
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    void backendClient?.close();
  });

export class BackendBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <section className="empty-state" role="alert">
          <h2>Local fixture unavailable</h2>
          <p>
            The backend rejected the query or is incompatible. These endpoints
            require a managed local backend. Start it, then retry. No live
            provider is enabled.
          </p>
          <button type="button" onClick={() => window.location.reload()}>
            Retry connection
          </button>
        </section>
      );
    return this.props.children;
  }
}
