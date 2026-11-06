import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { RegistryRecord } from "@fantastic.dev/convex-sandbox";
import { MachineCard } from "../../src/machine-card";
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
  if (location.search.includes("list"))
    return (
      <main className="workbench workflow-page">
        <p>Offline UI test. Synthetic owned bindings; no Boat calls.</p>
        <h1>Owned machines</h1>
        <p className="lede">
          Production list cards with synthetic scoped component records.
        </p>
        <div className="owned-machine-list">
          {[
            initial,
            {
              ...initial,
              key: "research-two",
              observedState: "starting" as const,
              resources: { cpuCount: 2 },
            },
          ].map((machine) => (
            <MachineCard key={machine.key} row={machine}>
              <a href="./machines.html" className="text-link">
                Open details →
              </a>
            </MachineCard>
          ))}
        </div>
      </main>
    );
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
