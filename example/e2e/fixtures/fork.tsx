import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ForkPanel } from "../../src/fork-panel";
import type { ForkView } from "../../convex/live/fork";
import type { Id } from "../../convex/_generated/dataModel";
import "../../src/style.css";
const source = {
  scope: "example-boat:synthetic",
  key: "research-one",
  reference: { provider: "boat", providerId: "synthetic-source" },
  generation: 1,
  version: 1,
  observedState: "stopped" as const,
  tombstone: false,
  refreshSequence: 1,
  observedSequence: 1,
  refresh: { status: "fresh" as const },
  updatedAt: 0,
};
const empty: ForkView = {
  source,
  child: null,
  intent: null,
  operation: null,
  stopConfirmed: !location.search.includes("pending"),
  fixtureReady: true,
  stopOperationId: "stop-original",
};
function Fixture() {
  const [view, setView] = useState<ForkView>(
      () =>
        JSON.parse(localStorage.getItem("synthetic-fork") ?? "null") ?? empty,
    ),
    [count, setCount] = useState(
      Number(localStorage.getItem("synthetic-fork-count") ?? 0),
    );
  const save = (next: ForkView) => {
    setView(next);
    localStorage.setItem("synthetic-fork", JSON.stringify(next));
  };
  return (
    <main className="workbench workflow-page">
      <p>
        Offline UI test. Synthetic stop proof, fork replies and file bytes. No
        Boat calls or real child.
      </p>
      <h1>Fork a stopped source</h1>
      <p>
        Synthetic fork callbacks:{" "}
        <output data-testid="fork-count">{count}</output>
      </p>
      <ForkPanel
        view={view}
        sourceKey="research-one"
        childKey="research-child"
        request={async (kind) => {
          if (kind === "start") {
            setCount((n) => n + 1);
            localStorage.setItem("synthetic-fork-count", String(count + 1));
            const unknown = location.search.includes("unknown");
            save({
              ...view,
              intent: {
                _id: "synthetic-fork" as Id<"liveForks">,
                _creationTime: 0,
                scope: source.scope,
                sourceKey: source.key,
                sourceId: source.reference.providerId,
                sourceGeneration: 1,
                childKey: "research-child",
                operationId: "fork-research-child",
                stopOperationId: "stop-original",
                path: "/home/user/.convex-sandbox-synthetic.txt",
                expectedText: "synthetic original bytes",
                reservationId:
                  "synthetic-reservation" as Id<"liveReservations">,
                copy: "unverified",
                ...(!unknown
                  ? { childId: "synthetic-child", childGeneration: 1 }
                  : {}),
              },
              child: unknown
                ? null
                : {
                    ...source,
                    key: "research-child",
                    reference: {
                      provider: "boat",
                      providerId: "synthetic-child",
                    },
                    observedState: "starting",
                  },
              operation: {
                scope: source.scope,
                key: source.key,
                reference: source.reference,
                generation: 1,
                sequence: 2,
                version: 1,
                operationId: "fork-research-child",
                kind: "fork",
                status: unknown ? "unknown" : "running",
                nativeImage: unknown
                  ? {}
                  : { providerOperationId: "synthetic-original-child-handle" },
                createdAt: 0,
                updatedAt: 0,
              },
            });
          } else if (
            kind === "inspect" &&
            view.intent &&
            view.operation?.nativeImage?.providerOperationId
          ) {
            save({
              ...view,
              intent: {
                ...view.intent,
                childId: "synthetic-child",
                childGeneration: 1,
              },
              child: {
                ...source,
                key: "research-child",
                reference: { provider: "boat", providerId: "synthetic-child" },
                observedState: "running",
              },
              operation: { ...view.operation, status: "succeeded" },
            });
          } else if (kind === "verify" && view.intent?.childId) {
            save({
              ...view,
              intent: {
                ...view.intent,
                copy: location.search.includes("mismatch")
                  ? "mismatch"
                  : "matched",
              },
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
