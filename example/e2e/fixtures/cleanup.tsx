import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CleanupPanel } from "../../src/cleanup-panel";
import type { CleanupView } from "../../convex/live/cleanupModel";
import "../../src/style.css";
declare global {
  interface Window {
    cleanupResets?: number;
    cleanupRequests?: number;
  }
}
function Fixture() {
  const unknown = location.search.includes("unknown"),
    readyReset = location.search.includes("terminal");
  const initial: CleanupView = {
    runId: "synthetic-run",
    targets: [
      {
        key: "research-child",
        kind: "fork",
        operationId: "fork-research-child",
        providerId: unknown ? null : "synthetic-child",
        generation: unknown ? null : 1,
        phase: readyReset ? "confirmed" : unknown ? "unresolved" : "ready",
        reason: unknown
          ? "No confirmed child identity. Keep the fork intent unresolved."
          : "Exact recorded child binding.",
        deleteToken: null,
      },
      {
        key: "research-parent",
        kind: "create",
        operationId: "create-research-parent",
        providerId: "synthetic-parent",
        generation: 1,
        phase: readyReset ? "confirmed" : "unresolved",
        reason: "Confirm child cleanup before parent deletion.",
        deleteToken: null,
      },
    ],
    unresolvedIntents: [],
    truncated: false,
    complete: readyReset,
    reviewToken: "synthetic-review",
    canReset: readyReset,
    resetAfter: readyReset ? 1 : null,
    archivedAt: null,
  };
  const [view, setView] = useState(initial);
  return (
    <main className="workbench workflow-page">
      <p>
        Offline verification harness. Synthetic cleanup records, no Boat
        requests.
      </p>
      <h1>Clean up this run</h1>
      <CleanupPanel
        view={view}
        request={async () => {
          window.cleanupRequests = (window.cleanupRequests ?? 0) + 1;
          setView({
            ...view,
            targets: view.targets.map((t, i) =>
              i === 0
                ? {
                    ...t,
                    phase: "pending",
                    reason: "Matching native deletion job is still pending.",
                  }
                : t,
            ),
          });
        }}
        inspect={async () => {}}
        reset={async () => {
          window.cleanupResets = (window.cleanupResets ?? 0) + 1;
          setView({ ...view, canReset: false, archivedAt: 2 });
        }}
      />
    </main>
  );
}
const root = document.getElementById("root");
if (!root) throw Error("No root");
createRoot(root).render(<Fixture />);
