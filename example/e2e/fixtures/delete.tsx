import { useState } from "react";
import { createRoot } from "react-dom/client";
import { DeletePanel } from "../../src/delete-panel";
import type { DeleteView } from "../../convex/live/delete";
import "../../src/style.css";
const row = {
  scope: "example-boat:synthetic",
  key: "research-one",
  reference: { provider: "boat", providerId: "synthetic-native" },
  generation: 1,
  version: 1,
  observedState: "stopped" as const,
  tombstone: false,
  refreshSequence: 1,
  observedSequence: 1,
  refresh: { status: "fresh" as const },
  updatedAt: 0,
};
function Fixture() {
  const [view, setView] = useState<DeleteView>({
    row,
    operation: null,
    reviewToken: "synthetic-review-token",
    phase: "not_requested",
  });
  return (
    <main className="workbench workflow-page">
      <p>
        Offline UI test. Synthetic owned binding and deletion job; no Boat
        calls.
      </p>
      <h1>Confirm owned cleanup</h1>
      <DeletePanel
        view={view}
        request={async () =>
          setView({
            ...view,
            row: {
              ...row,
              observedState: "stopping",
              activeOperationId: "delete-1",
            },
            operation: {
              scope: row.scope,
              key: row.key,
              operationId: "delete-1",
              kind: "delete",
              reference: row.reference,
              generation: 1,
              sequence: 1,
              version: 1,
              status: "unknown",
              nativeLifecycle: { id: "synthetic-delete-job" },
              createdAt: 0,
              updatedAt: 0,
            },
            phase: "pending",
          })
        }
        inspect={async () => {
          if (!view.operation) return;
          const mismatch = location.search.includes("wrong");
          setView({
            ...view,
            row: mismatch
              ? { ...row, observedState: "stopping" }
              : { ...row, observedState: "deleted", tombstone: true },
            operation: {
              ...view.operation,
              status: mismatch ? "unknown" : "succeeded",
              ...(mismatch ? { errorCode: "validation" as const } : {}),
            },
            phase: mismatch ? "unresolved" : "confirmed",
          });
        }}
      />
      {!view.operation && (
        <button
          type="button"
          onClick={() =>
            setView({
              ...view,
              row: {
                ...row,
                generation: 2,
                reference: {
                  provider: "boat",
                  providerId: "synthetic-new-target",
                },
              },
              reviewToken: "synthetic-new-review",
            })
          }
        >
          Inject rebound target
        </button>
      )}
    </main>
  );
}
const root = document.getElementById("root");
if (!root) throw Error("No root");
createRoot(root).render(<Fixture />);
