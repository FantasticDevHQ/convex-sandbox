import { Component, type ReactNode } from "react";

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
