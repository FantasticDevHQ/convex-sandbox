import { useRef, useState } from "react";
import type { ForkView } from "../convex/live/fork";
export function ForkPanel({
  view,
  sourceKey,
  childKey,
  request,
}: {
  view: ForkView | undefined;
  sourceKey: string;
  childKey: string;
  request: (kind: "start" | "inspect" | "verify") => Promise<unknown>;
}) {
  const busy = useRef(false);
  const [pending, setPending] = useState(false),
    [risk, setRisk] = useState(false),
    [failed, setFailed] = useState(false);
  async function run(kind: "start" | "inspect" | "verify") {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setFailed(false);
    try {
      await request(kind);
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  if (!view) return <p>Loading retained fork state…</p>;
  const unknown =
    !!view.intent &&
    (!view.operation ||
      view.operation.status === "unknown" ||
      (!view.intent.childId &&
        !view.operation.nativeImage?.providerOperationId));
  return (
    <div className="fork-workspace">
      <p className="lede">
        Fork a confirmed stopped source into a new logical key. The source
        binding stays unchanged; a fork creates a billable machine.
      </p>
      <dl className="setup-facts">
        <div>
          <dt>Source key / original ID</dt>
          <dd data-testid="fork-source">
            {sourceKey} /{" "}
            {view.intent?.sourceId ??
              view.source?.reference.providerId ??
              "Unavailable"}
          </dd>
        </div>
        <div>
          <dt>Child key / accepted ID</dt>
          <dd data-testid="fork-child">
            {childKey} / {view.intent?.childId ?? "Not confirmed"}
          </dd>
        </div>
        <div>
          <dt>Source stop</dt>
          <dd data-testid="fork-stop">
            {view.intent
              ? "Original stop retained"
              : view.stopConfirmed
                ? "Confirmed completed"
                : "Not confirmed"}
          </dd>
        </div>
      </dl>
      {!view.intent ? (
        <section className="setup-card">
          <h2>Source snapshot boundary</h2>
          <p>
            Prepare the retained home fixture in source details, then complete
            its nonforced stop. Running forks can omit recent writes. No saved
            snapshot or capture substitute is used.
          </p>
          <p>
            Home fixture: {view.fixtureReady ? "Prepared" : "Not prepared"}.
          </p>
          <label className="risk-check">
            <input
              type="checkbox"
              checked={risk}
              disabled={pending}
              onChange={(e) => setRisk(e.target.checked)}
            />
            I understand this creates a billable child within the existing
            approved run.
          </label>
          <button
            type="button"
            disabled={
              pending || !risk || !view.stopConfirmed || !view.fixtureReady
            }
            onClick={() => void run("start")}
          >
            Fork stopped source
          </button>
        </section>
      ) : (
        <section className="setup-card">
          <h2>Retained child intent</h2>
          <p data-testid="fork-state">
            {unknown
              ? "Unknown child outcome"
              : view.intent.childId && view.operation?.status === "succeeded"
                ? "Child registered and ready"
                : "Pending child readiness"}
          </p>
          <p>
            Original operation: <code>{view.intent.operationId}</code>
          </p>
          <p>
            Native readiness handle:{" "}
            {view.operation?.nativeImage?.providerOperationId ? (
              <code>{view.operation.nativeImage.providerOperationId}</code>
            ) : (
              "Not known"
            )}
          </p>
          {unknown && (
            <p role="alert">
              Keep this unresolved child intent and its allowance reservation.
              Inspection never repeats the fork, guesses a child ID or scans the
              account. No confirmed child ID is not proof of no stopped child.
            </p>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() => void run("inspect")}
          >
            Inspect original fork
          </button>
        </section>
      )}
      <section className="setup-card">
        <h2>Retained copy verification</h2>
        <p>
          Wait for the child's native readiness and guest file access, then
          compare every byte of the original home fixture.
        </p>
        <p data-testid="fork-copy">
          {view.intent?.copy === "matched"
            ? "Copy bytes match"
            : view.intent?.copy === "mismatch"
              ? "Copy bytes differ"
              : "Copy not verified"}
        </p>
        {view.intent?.copy === "mismatch" && (
          <p role="alert">
            Child bytes differ from the original fixture. Keep both bindings;
            this does not qualify copy persistence.
          </p>
        )}
        <button
          type="button"
          disabled={
            pending ||
            !view.intent?.childId ||
            view.operation?.status !== "succeeded"
          }
          onClick={() => void run("verify")}
        >
          Verify retained copy
        </button>
        <p>
          The parent remains stopped. Resume and exact-owned cleanup use each
          machine's existing workflow.
        </p>
      </section>
      {pending && <p role="status">Working on the retained operation…</p>}
      {failed && (
        <p role="alert">
          This fork request or inspection was not confirmed. Keep {sourceKey} →{" "}
          {childKey} and inspect its original intent. No automatic retry
          occurred.
        </p>
      )}
    </div>
  );
}
