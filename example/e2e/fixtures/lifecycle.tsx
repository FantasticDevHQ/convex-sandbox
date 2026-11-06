import { useState } from "react";
import { createRoot } from "react-dom/client";
import { LifecyclePanel } from "../../src/lifecycle-panel";
import type { LifecycleView } from "../../convex/live/lifecycle";
import type { Id } from "../../convex/_generated/dataModel";
import "../../src/style.css";
const row = {
  scope: "example-boat:synthetic",
  key: "research-one",
  reference: { provider: "boat", providerId: "synthetic-native" },
  generation: 1,
  version: 1,
  observedState: "running" as const,
  tombstone: false,
  refreshSequence: 1,
  observedSequence: 1,
  refresh: { status: "fresh" as const },
  updatedAt: 0,
};
const fixture = {
  _id: "synthetic-fixture" as Id<"liveFixtures">,
  _creationTime: 0,
  scope: row.scope,
  key: row.key,
  providerId: row.reference.providerId,
  generation: 1,
  path: "/home/user/.convex-sandbox-synthetic.txt",
  expectedText: "synthetic original bytes",
  status: "written" as const,
  writtenAt: 1,
};
function Fixture() {
  const [view, setView] = useState<LifecycleView>({
    row,
    fixture: null,
    operation: null,
  });
  return (
    <main className="workbench workflow-page">
      <p>
        Offline UI test. Synthetic fixture bytes and lifecycle jobs; no Boat
        calls.
      </p>
      <h1>Owned machine lifecycle</h1>
      <LifecyclePanel
        view={view}
        request={async (action, id) => {
          if (action === "prepare") setView({ ...view, fixture });
          else if (action === "stop" || action === "start") {
            setView({
              ...view,
              row: {
                ...row,
                observedState: action === "stop" ? "stopping" : "starting",
                activeOperationId: id,
              },
              fixture: view.fixture
                ? {
                    ...view.fixture,
                    status: action === "start" ? "awaiting_resume" : "written",
                  }
                : null,
              operation: {
                scope: row.scope,
                key: row.key,
                operationId: id ?? "synthetic-operation",
                kind: action,
                reference: row.reference,
                generation: 1,
                sequence: 1,
                version: 1,
                status: "running",
                nativeLifecycle:
                  action === "stop" ? { id: "synthetic-stop-job" } : undefined,
                createdAt: 0,
                updatedAt: 0,
              },
            });
          } else if (view.operation) {
            const resumed = view.operation.kind === "start";
            setView({
              ...view,
              row: { ...row, observedState: resumed ? "running" : "stopped" },
              operation: { ...view.operation, status: "succeeded" },
              fixture:
                view.fixture && resumed
                  ? {
                      ...view.fixture,
                      status: location.search.includes("mismatch")
                        ? "mismatch"
                        : "verified",
                    }
                  : view.fixture,
            });
          }
        }}
      />
    </main>
  );
}
const root = document.getElementById("root");
if (!root) throw Error("No root");
createRoot(root).render(<Fixture />);
