import { useState } from "react";
import { createRoot } from "react-dom/client";
import { OperatorGate, OperatorSessionProvider } from "../../src/operator-gate";
import "../../src/style.css";
const root = document.getElementById("root");
if (!root) throw new Error("No root");
// Test-only entry, never part of the Vite production entry/import graph.
function Fixture() {
  const [route, setRoute] = useState(0);
  return (
    <main className="workbench workflow-page">
      <p>
        Offline boundary test. Synthetic session and machine; no provider calls.
      </p>
      <button type="button" onClick={() => setRoute(route + 1)}>
        Change private route
      </button>
      <OperatorGate
        key={route}
        state="authorized"
        onSignIn={() => {}}
        onSignOut={async () => {
          if (location.search.includes("fail"))
            throw new Error("Synthetic failure");
        }}
      >
        <p>fixture-machine-private</p>
      </OperatorGate>
    </main>
  );
}
createRoot(root).render(
  <OperatorSessionProvider>
    <Fixture />
  </OperatorSessionProvider>,
);
