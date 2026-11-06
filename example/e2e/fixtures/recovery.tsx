import { createRoot } from "react-dom/client";
import { RecoveryPanel } from "../../src/recovery-panel";
import type { OperationRecord } from "@fantastic.dev/convex-sandbox";
import type { RecoveryContext } from "../../convex/live/recovery";
import "../../src/style.css";
declare global {
  interface Window {
    readRecovery?: () => Promise<{
      context: RecoveryContext;
      operations: OperationRecord[];
      key: string;
    }>;
    recoveryInspections?: number;
  }
}
const reference = { provider: "boat", providerId: "synthetic-original" };
const operation: OperationRecord = {
  scope: "synthetic-recovery",
  key: "research-one",
  operationId: "stop-original",
  kind: "stop",
  reference,
  generation: 1,
  sequence: 1,
  version: 1,
  status: "pending",
  createdAt: 1,
  updatedAt: 1,
};
async function mount() {
  const data = window.readRecovery
    ? await window.readRecovery()
    : {
        key: "research-one",
        context: {
          row: {
            scope: operation.scope,
            key: operation.key,
            reference,
            generation: location.search.includes("stale") ? 2 : 1,
            version: 1,
            observedState: "unknown" as const,
            tombstone: false,
            refreshSequence: 0,
            observedSequence: 0,
            refresh: { status: "never" as const },
            updatedAt: 1,
          },
          provision: null,
          admissions: [],
          admissionsTruncated: false,
          forkSource: null,
        },
        operations: [
          operation,
          {
            ...operation,
            operationId: "fork-original",
            kind: "fork" as const,
            sequence: 2,
            status: "unknown" as const,
          },
        ],
      };
  const root = document.getElementById("root");
  if (!root) throw Error("No root");
  createRoot(root).render(
    <main className="workbench workflow-page">
      <p>
        Verification harness. Synthetic Boat identities; no provider requests.{" "}
        {window.readRecovery
          ? "Records read from the owned anonymous backend."
          : "Offline panel fixture."}
      </p>
      <h1>Operations</h1>
      <RecoveryPanel
        machineKey={data.key}
        context={data.context}
        operations={data.operations}
        inspect={async () => {
          window.recoveryInspections = (window.recoveryInspections ?? 0) + 1;
        }}
      />
    </main>,
  );
}
void mount();
