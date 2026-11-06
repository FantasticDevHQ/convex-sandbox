import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CreatePanel } from "../../src/create-panel";
import type { CreationView } from "../../convex/live/create";
import "../../src/style.css";
const empty: CreationView = {
  key: "research-one",
  operationId: "create-research-one",
  reservationHeld: false,
  reservationAt: null,
  reservationUnknown: false,
  provision: null,
  registry: null,
};
function Fixture() {
  const [view, setView] = useState<CreationView>(
    () =>
      JSON.parse(localStorage.getItem("synthetic-create-view") ?? "null") ??
      empty,
  );
  const [count, setCount] = useState(0);
  const save = (value: CreationView) => {
    setView(value);
    localStorage.setItem("synthetic-create-view", JSON.stringify(value));
  };
  return (
    <main className="workbench workflow-page">
      <p>
        Offline UI test. Synthetic provider replies and reservations; no Boat
        calls or actual approval.
      </p>
      <h1>Create a test machine</h1>
      <p>
        Synthetic dispatch callbacks:{" "}
        <output data-testid="synthetic-dispatch-count">{count}</output>
      </p>
      <CreatePanel
        view={view}
        selectedKey={view.key}
        request={async (key) => {
          setCount((n) => n + 1);
          await new Promise((resolve) => setTimeout(resolve, 150));
          const unknown = location.search.includes("lost");
          save({
            ...empty,
            key,
            operationId: `create-${key}`,
            reservationHeld: true,
            reservationAt: Date.now(),
            reservationUnknown: unknown,
            provision: {
              scope: "example-boat:synthetic",
              key,
              provider: "boat",
              operationId: `create-${key}`,
              idempotency: "native",
              status: unknown ? "unknown" : "succeeded",
              version: 2,
              leaseUntil: 0,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
            registry: unknown
              ? null
              : {
                  scope: "example-boat:synthetic",
                  key,
                  reference: {
                    provider: "boat",
                    providerId: "synthetic-native",
                  },
                  generation: 1,
                  version: 1,
                  observedState: "starting",
                  tombstone: false,
                  refreshSequence: 1,
                  observedSequence: 1,
                  refresh: { status: "fresh" },
                  updatedAt: Date.now(),
                },
          });
        }}
      />
      {view.registry && (
        <button
          type="button"
          onClick={() => {
            if (!view.registry) return;
            save({
              ...view,
              registry: {
                ...view.registry,
                observedState: "running",
                refreshSequence: 2,
              },
            });
          }}
        >
          Inject independent running observation
        </button>
      )}
    </main>
  );
}
const root = document.getElementById("root");
if (!root) throw Error("No root");
createRoot(root).render(<Fixture />);
