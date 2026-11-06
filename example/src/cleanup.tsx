import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { OperatorAccess } from "./operator-access";
import { CleanupPanel } from "./cleanup-panel";
function Run({ runId }: { runId: string }) {
  const [revision, setRevision] = useState(0);
  const view = useQuery(api.live.cleanup.status, { runId, revision }),
    request = useAction(api.live.cleanup.requestNext),
    inspect = useAction(api.live.cleanup.inspectNext),
    reset = useMutation(api.live.cleanup.resetView);
  if (!view) return <p role="status">Loading recorded run targets…</p>;
  return (
    <>
      <button type="button" onClick={() => setRevision((n) => n + 1)}>
        Refresh retained cleanup review
      </button>
      <CleanupPanel
        view={view}
        request={(confirmation, reviewToken) =>
          request({ runId, confirmation, reviewToken })
        }
        inspect={() => inspect({ runId })}
        reset={(confirmation, reviewToken) =>
          reset({ runId, confirmation, reviewToken })
        }
      />
    </>
  );
}
function Connected() {
  const proposal = useQuery(api.live.allowance.proposal, {});
  if (!proposal) return <p role="status">Loading retained run…</p>;
  return proposal.approval ? (
    <Run
      key={proposal.approval.plan.runId}
      runId={proposal.approval.plan.runId}
    />
  ) : (
    <section className="setup-card">
      <h2>No retained run approval</h2>
      <p>
        Cleanup targets only a verified operator's recorded run. It never scans
        account inventory or infers ownership from a machine name.
      </p>
      <a className="text-link" href="/setup">
        Review trusted host setup →
      </a>
    </section>
  );
}
export function CleanupPage() {
  return (
    <section className="workflow-page">
      <p className="eyebrow">BOAT / EXACT OWNED CLEANUP</p>
      <h1>Clean up this run</h1>
      <OperatorAccess>
        <Connected />
      </OperatorAccess>
    </section>
  );
}
