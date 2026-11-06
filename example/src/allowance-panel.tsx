import { useEffect, useRef, useState } from "react";
import type { RunPlan } from "../convex/live/allowanceModel";
export type ApprovalSummary = {
  plan: RunPlan;
  reviewToken: string;
  approvedAt: number;
  machinesReserved: number;
  startsReserved: number;
  activeReservations: number;
  estimatedUsdReserved: number;
};
export type RunReview = {
  plan: RunPlan | null;
  reviewToken: string | null;
  approval: ApprovalSummary | null;
};
const dollars = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(value);
export function AllowancePanel({
  review,
  approve,
}: {
  review: RunReview | undefined;
  approve: (token: string) => Promise<unknown>;
}) {
  if (!review) return <p role="status">Loading reviewed run…</p>;
  return (
    <ReviewPanel
      key={review.reviewToken ?? "unconfigured"}
      review={review}
      approve={approve}
    />
  );
}
function ReviewPanel({
  review,
  approve,
}: {
  review: RunReview;
  approve: (token: string) => Promise<unknown>;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(Date.now());
  const busy = useRef(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const plan = review.plan ?? review.approval?.plan;
  if (!plan)
    return (
      <div className="setup-card">
        <span className="step">NO REVIEWED PROPOSAL</span>
        <h2>A live run needs its own review.</h2>
        <p>
          No run is approved. Ask the host owner to configure a scoped plan with
          an account, estimate and finite limits. Setup and project planning
          grant no spending authority.
        </p>
      </div>
    );
  const approval = review.approval;
  const matches = approval?.reviewToken === review.reviewToken;
  const expired =
    now >= plan.expiresAt ||
    (approval !== null &&
      now >= approval.approvedAt + approval.plan.durationMinutes * 60_000);
  const active = Boolean(matches && !expired);
  const canApprove = Boolean(
    review.plan && review.reviewToken && !expired && !approval,
  );
  async function confirm() {
    if (busy.current || !acknowledged || !canApprove || !review.reviewToken)
      return;
    busy.current = true;
    setPending(true);
    setFailed(false);
    try {
      await approve(review.reviewToken);
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <div className="allowance-panel">
      <p className="lede">
        A finite plan for billable work. Review the account, limits and cost
        before recording explicit approval.
      </p>
      <div className="workspace-facts">
        <div>
          <span>Machine size</span>
          <strong>Small</strong>
          <small>Host-reviewed size only</small>
        </div>
        <div>
          <span>Concurrent maximum</span>
          <strong>{plan.maxConcurrent}</strong>
          <small>Unknown outcomes keep their slot</small>
        </div>
        <div>
          <span>Approval</span>
          <strong data-testid="approval-status">
            {active ? "Active" : expired ? "Expired" : "Not active"}
          </strong>
          <small>Approval creates no machine</small>
        </div>
      </div>
      <section className="setup-card">
        <span className="step">01 / EXACT ACCOUNT</span>
        <h2>Know where this run belongs.</h2>
        <dl className="setup-facts">
          <div>
            <dt>Run</dt>
            <dd>{plan.runId}</dd>
          </div>
          <div>
            <dt>Boat account</dt>
            <dd>{plan.accountId}</dd>
          </div>
          <div>
            <dt>Selected wallet</dt>
            <dd>{plan.wallet}</dd>
          </div>
          <div>
            <dt>Wallet team ID</dt>
            <dd>{plan.walletTeamId ?? "Personal wallet"}</dd>
          </div>
        </dl>
        <p>
          Approval verifies the server-selected Boat account and wallet with
          read-only requests. Credentials stay on the server.
        </p>
      </section>
      <section className="setup-card">
        <span className="step">02 / RUN LIMITS</span>
        <h2>A bounded admission window.</h2>
        <dl className="setup-facts">
          <div>
            <dt>New machines / starts</dt>
            <dd>
              {plan.maxMachines} / {plan.maxStarts}
            </dd>
          </div>
          <div>
            <dt>Run duration</dt>
            <dd>{plan.durationMinutes} minutes from approval</dd>
          </div>
          <div>
            <dt>Approval expiry</dt>
            <dd>{new Date(plan.expiresAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt>Concurrent reservations</dt>
            <dd>
              {approval?.activeReservations ?? 0} / {plan.maxConcurrent}
            </dd>
          </div>
        </dl>
        <p>
          The earlier duration or expiry closes admission. It does not guarantee
          machine shutdown.
        </p>
      </section>
      <section className="setup-card cost-review">
        <span className="step">03 / COST REVIEW</span>
        <h2>Review the cost and residual risk.</h2>
        <div className="cost-values">
          <div>
            <span>Reviewed estimate</span>
            <strong data-testid="run-estimate">
              {dollars(plan.estimateUsd)}
            </strong>
          </div>
          <div>
            <span>Dollar allowance</span>
            <strong>{dollars(plan.allowanceUsd)}</strong>
          </div>
        </div>
        <p>
          The estimate covers the reviewed maximum starts and duration. It is
          supplied by the host owner, not a live price quote. This host
          admission allowance is not a provider-enforced billing cap.
        </p>
        <p className="risk-notice">
          Cleanup failure, stopped resources or an unknown creation outcome can
          cause further charges. Costs may continue after expiry or exceed the
          estimate and allowance. Exact-owned cleanup and reconciliation remain
          necessary.
        </p>
      </section>
      {approval && (
        <section className="setup-card" aria-label="Durable run ledger">
          <span className="step">RESERVATIONS / RETAINED</span>
          <h2>Keep uncertain work visible.</h2>
          <p>
            {approval.machinesReserved} machines · {approval.startsReserved}{" "}
            starts · {dollars(approval.estimatedUsdReserved)} estimated
            admission cost reserved.
          </p>
          <p>
            Reservations remain counted across reloads and expiry, including
            lost replies. Reapproving cannot reset this ledger. A repeated
            intent never dispatches again.
          </p>
        </section>
      )}
      <section className="setup-card">
        <span className="step">04 / EXPLICIT APPROVAL</span>
        <h2>
          {active
            ? "This reviewed run is approved."
            : "Approve only this reviewed run."}
        </h2>
        {!approval && (
          <>
            <label className="risk-acknowledgement">
              <input
                type="checkbox"
                checked={acknowledged}
                disabled={!canApprove || pending}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
              I approve this bounded run and accept the stated residual-charge
              and cleanup risk.
            </label>
            <button
              type="button"
              disabled={!canApprove || !acknowledged || pending}
              onClick={() => void confirm()}
            >
              {pending ? "Verifying account…" : "Approve reviewed run"}
            </button>
          </>
        )}
        {active && (
          <p>
            Future billable actions must still reserve admission atomically and
            satisfy their workflow guards.
          </p>
        )}
        {expired && (
          <p role="status">
            This admission window has expired. Existing reservations remain
            counted.
          </p>
        )}
        {approval && !matches && (
          <p role="alert">
            The current proposal differs from the retained approval. Admission
            is refused; this page cannot replace or reset the ledger.
          </p>
        )}
        {failed && (
          <p role="alert">
            Approval could not be recorded. Recheck the account, proposal and
            operator access. No billable action was started.
          </p>
        )}
      </section>
    </div>
  );
}
