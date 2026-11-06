import { useAction, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { OperatorAccess } from "./operator-access";
import { AllowancePanel } from "./allowance-panel";
function ConnectedReview() {
  const review = useQuery(api.live.allowance.proposal, {});
  const approve = useAction(api.live.allowance.approve);
  return (
    <AllowancePanel
      review={review}
      approve={(reviewToken) => approve({ reviewToken, acknowledgeRisk: true })}
    />
  );
}
export function AllowancePage() {
  return (
    <section className="workflow-page">
      <p className="eyebrow">BOAT / RUN REVIEW</p>
      <h1>Review a live run</h1>
      <OperatorAccess>
        <ConnectedReview />
      </OperatorAccess>
    </section>
  );
}
