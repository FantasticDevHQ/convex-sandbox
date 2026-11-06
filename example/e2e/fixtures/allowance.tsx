import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AllowancePanel, type RunReview } from "../../src/allowance-panel";
import "../../src/style.css";
const plan = {
  runId: "synthetic-reviewed-run",
  scope: "example-boat:synthetic",
  accountId: "synthetic-account",
  wallet: "synthetic-team",
  walletTeamId: "synthetic-wallet-team",
  size: "small" as const,
  expiresAt:
    Date.now() + (location.search.includes("expired") ? -60_000 : 3_600_000),
  maxMachines: 2,
  maxStarts: 2,
  maxConcurrent: 1,
  durationMinutes: 10,
  estimateUsd: 0.2,
  allowanceUsd: 1,
};
function Fixture() {
  const [review, setReview] = useState<RunReview>({
    plan,
    reviewToken: "synthetic-review-token",
    approval: null,
  });
  return (
    <main className="workbench workflow-page">
      <p>
        Offline UI test. Synthetic proposal and approval; no Boat calls or
        spending authorization.
      </p>
      <h1>Review a live run</h1>
      <AllowancePanel
        review={review}
        approve={async () => {
          if (location.search.includes("fail"))
            throw Error("Synthetic failure");
          setReview({
            ...review,
            approval: {
              plan,
              reviewToken: "synthetic-review-token",
              approvedAt: Date.now(),
              machinesReserved: 0,
              startsReserved: 0,
              activeReservations: 0,
              estimatedUsdReserved: 0,
            },
          });
        }}
      />
    </main>
  );
}
const root = document.getElementById("root");
if (!root) throw Error("No root");
createRoot(root).render(<Fixture />);
