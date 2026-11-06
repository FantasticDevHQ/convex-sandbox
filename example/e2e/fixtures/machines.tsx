import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { RegistryRecord } from "@fantastic.dev/convex-sandbox";
import { MachineDetailPanel } from "../../src/machine-detail";
import "../../src/style.css";
const root = document.getElementById("root");
if (!root) throw new Error("No root");
const initial: RegistryRecord = {
  scope: "example-boat:synthetic",
  key: "research-one",
  reference: { provider: "boat", providerId: "synthetic-native-id" },
  generation: 1,
  version: 1,
  observedState: "unknown",
  tombstone: false,
  refreshSequence: 0,
  observedSequence: 0,
  refresh: { status: "never" },
  updatedAt: 0,
};
function Fixture() {
  const [row, setRow] = useState(initial);
  return (
    <main className="workbench workflow-page">
      <p>
        Offline UI test. Synthetic binding and provider responses; no Boat
        calls.
      </p>
      <h1>Machine details</h1>
      <MachineDetailPanel
        row={row}
        refresh={async () => {
          if (location.search.includes("fail"))
            setRow({
              ...row,
              refresh: { status: "failed", errorCode: "capacity" },
            });
          else
            setRow({
              ...row,
              version: 2,
              observedState: "stopped",
              resources: { cpuCount: 2 },
              refresh: { status: "fresh" },
              observedAt: Date.now(),
            });
        }}
      />
    </main>
  );
}
createRoot(root).render(<Fixture />);
