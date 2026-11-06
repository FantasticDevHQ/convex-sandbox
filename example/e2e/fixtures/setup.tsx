import { createRoot } from "react-dom/client";
import { SetupPanel } from "../../src/setup-panel";
import "../../src/style.css";
const root = document.getElementById("root");
if (!root) throw new Error("No root");
const missing = location.search.includes("missing");
const configuration = {
  keyConfigured: !missing,
  missing: missing ? ["BOAT_API_KEY" as const] : [],
  wallet: "personal",
};
createRoot(root).render(
  <main className="workbench workflow-page">
    <p>
      Offline UI test. Synthetic operator and provider responses; no Boat calls.
    </p>
    <h1>Connect the example</h1>
    <SetupPanel
      configuration={configuration}
      check={async () => ({
        ...configuration,
        state: location.search.includes("fail") ? "unavailable" : "checked",
        accountId: "account-fixture",
        walletTeamId: null,
        canStart: true,
        activeSandboxes: 0,
        maxActiveSandboxes: 2,
      })}
    />
  </main>,
);
