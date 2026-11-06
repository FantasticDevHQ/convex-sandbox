import { useState } from "react";
import type { CleanupView } from "../convex/live/cleanupModel";
export function CleanupPanel({
  view,
  request,
  inspect,
  reset,
}: {
  view: CleanupView;
  request: (confirmation: string, reviewToken: string) => Promise<unknown>;
  inspect: () => Promise<unknown>;
  reset: (confirmation: string, reviewToken: string) => Promise<unknown>;
}) {
  const [confirmation, setConfirmation] = useState(""),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setFailed(false);
    try {
      await fn();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  const next = view.targets.find(
    (t) => !["confirmed", "not_created"].includes(t.phase),
  );
  return (
    <>
      <p className="lede">
        Clean only the recorded targets in <strong>{view.runId}</strong>.
        Confirm each child before its parent. Unresolved ownership records stay
        available for recovery.
      </p>
      <section className="workspace-facts" aria-label="Run cleanup status">
        <div>
          <span>Confirmed deleted</span>
          <strong>
            {view.targets.filter((t) => t.phase === "confirmed").length}
          </strong>
          <small>Matching native completion proof</small>
        </div>
        <div>
          <span>Pending deletion</span>
          <strong>
            {view.targets.filter((t) => t.phase === "pending").length}
          </strong>
          <small>Accepted is not completed</small>
        </div>
        <div>
          <span>Unresolved</span>
          <strong>
            {view.targets.filter((t) => t.phase === "unresolved").length +
              view.unresolvedIntents.length}
          </strong>
          <small>Recovery records retained</small>
        </div>
      </section>
      {failed && (
        <p role="alert">
          Cleanup was not confirmed. Keep these records and inspect the original
          operation before requesting further work.
        </p>
      )}
      {view.truncated && (
        <p role="alert">
          The retained run exceeds the bounded review. No cleanup or reset can
          proceed from this partial view.
        </p>
      )}
      <section className="setup-card">
        <span className="step">EXACT OWNERSHIP</span>
        <h2>Recorded targets</h2>
        <p>
          Unrelated account machines are excluded. Every mutation requires a
          matching original native ID and generation.
        </p>
        {view.targets.length === 0 && (
          <p>No machine targets were admitted in this retained run.</p>
        )}
        {view.targets.map((t) => (
          <article
            className="cleanup-target"
            key={t.operationId}
            data-testid="cleanup-target"
          >
            <span className="step">
              {t.kind} / {t.phase}
            </span>
            <h3>{t.key}</h3>
            <p>
              <code>{t.providerId ?? "No confirmed native ID"}</code> ·{" "}
              {t.generation ? `Generation ${t.generation}` : "Unbound intent"}
            </p>
            <p>{t.reason}</p>
            <a
              className="text-link"
              href={`/operations?machine=${encodeURIComponent(t.key)}&operation=${encodeURIComponent(t.operationId)}`}
            >
              Open retained recovery records →
            </a>
          </article>
        ))}
        {view.unresolvedIntents.map((id) => (
          <p key={id}>
            Unresolved admission: <code>{id}</code>. Preserve its original
            records.
          </p>
        ))}
      </section>
      <section className="setup-card" aria-label="Cleanup controls">
        <h2>
          {view.complete
            ? "Known resource cleanup confirmed"
            : "Cleanup remains unresolved"}
        </h2>
        <p>
          One explicit request targets the next recorded machine. Inspect its
          native job separately. A pending or unknown child blocks parent
          deletion.
        </p>
        <label className="machine-key-field">
          Type the exact run ID
          <input
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            maxLength={100}
            autoComplete="off"
          />
        </label>
        <button
          type="button"
          disabled={
            busy ||
            confirmation !== view.runId ||
            !next ||
            next.phase !== "ready" ||
            view.truncated ||
            view.archivedAt !== null
          }
          onClick={() =>
            void act(() => request(confirmation, view.reviewToken))
          }
        >
          {busy ? "Working…" : "Request next recorded deletion"}
        </button>{" "}
        <button
          type="button"
          disabled={
            busy ||
            view.truncated ||
            !view.targets.some(
              (t) =>
                t.providerId && ["pending", "unresolved"].includes(t.phase),
            )
          }
          onClick={() => void act(inspect)}
        >
          Inspect original deletion
        </button>
        <p className="setup-note">
          Completed native cleanup is not physical erasure or measured zero
          billing. No account sweep or replay is performed.
        </p>
      </section>
      <section className="setup-card">
        <span className="step">RECOVERY RETENTION</span>
        <h2>
          {view.archivedAt !== null ? "Run view archived" : "Reset protected"}
        </h2>
        <p>
          Reset archives this completed view only after all intents resolve and
          24 hours pass after the later of run expiry or the latest terminal
          proof. Ownership journals and cumulative allowance counters remain
          intact.
        </p>
        {!view.complete && (
          <p>
            Reset is unavailable while an intent or deletion remains unresolved.
          </p>
        )}
        {view.resetAfter !== null && (
          <p>Retention ends: {new Date(view.resetAfter).toISOString()}.</p>
        )}
        <button
          type="button"
          disabled={busy || !view.canReset || confirmation !== view.runId}
          onClick={() => void act(() => reset(confirmation, view.reviewToken))}
        >
          Reset run view
        </button>
      </section>
    </>
  );
}
