import { useRef, useState } from "react";
import type { LifecycleView } from "../convex/live/lifecycle";
export function LifecyclePanel({
  view,
  request,
}: {
  view: LifecycleView | undefined;
  request: (
    action: "prepare" | "stop" | "start" | "inspect",
    operationId?: string,
  ) => Promise<unknown>;
}) {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  async function send(action: "prepare" | "stop" | "start" | "inspect") {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setFailed(false);
    try {
      await request(
        action,
        action === "stop" || action === "start"
          ? crypto.randomUUID()
          : undefined,
      );
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  if (!view) return <p role="status">Loading owned lifecycle…</p>;
  if (!view.row) return <p>No authorized Boat binding exists for this key.</p>;
  const { row, operation, fixture } = view;
  const unfinished = Boolean(
    row.activeOperationId ||
    (operation &&
      !["succeeded", "failed", "cancelled"].includes(operation.status)),
  );
  return (
    <section className="setup-card lifecycle-panel">
      <span className="step">LIFECYCLE / RETAINED HOME BYTES</span>
      <h2>Stop. Resume. Verify.</h2>
      <div className="workspace-facts">
        <div>
          <span>Accepted machine state</span>
          <strong data-testid="lifecycle-state">{row.observedState}</strong>
          <small>Acceptance is not completion</small>
        </div>
        <div>
          <span>Disk fixture</span>
          <strong data-testid="persistence-state">
            {fixture?.status === "verified"
              ? "Bytes verified"
              : fixture?.status === "mismatch"
                ? "Bytes differ"
                : fixture?.writtenAt
                  ? "Awaiting resume verification"
                  : "Not prepared"}
          </strong>
          <small>RAM and processes are discarded on stop</small>
        </div>
      </div>
      {fixture && (
        <p>
          Retained path: <code>{fixture.path}</code>
        </p>
      )}
      {operation && (
        <div aria-live="polite">
          <p>
            Operation <code>{operation.operationId}</code>: {operation.status}
          </p>
          {operation.nativeLifecycle && (
            <p>Native job retained for read-only reconciliation.</p>
          )}
          {unfinished && (
            <p>
              Work is unfinished. Inspect the original operation; do not treat
              its accepted reply as completion.
            </p>
          )}
        </div>
      )}
      <div className="lifecycle-actions">
        {!fixture?.writtenAt && (
          <button
            type="button"
            disabled={pending || unfinished || row.observedState !== "running"}
            onClick={() => void send("prepare")}
          >
            Prepare retained home fixture
          </button>
        )}
        <button
          type="button"
          disabled={
            pending ||
            unfinished ||
            row.observedState !== "running" ||
            row.tombstone
          }
          onClick={() => void send("stop")}
        >
          Stop owned machine
        </button>
        <button
          type="button"
          disabled={
            pending ||
            unfinished ||
            row.observedState !== "stopped" ||
            !fixture?.writtenAt ||
            row.tombstone
          }
          onClick={() => void send("start")}
        >
          Resume approved machine
        </button>
        <button
          type="button"
          disabled={pending || row.tombstone}
          onClick={() => void send("inspect")}
        >
          {pending
            ? "Checking original operation…"
            : "Inspect progress and verify bytes"}
        </button>
      </div>
      {failed && (
        <p role="alert">
          The operation was not confirmed. Inspect its original persisted record
          before retrying. Provider errors and credentials are withheld.
        </p>
      )}
      {fixture?.status === "mismatch" && (
        <p role="alert">
          The retained home file differs from the original bytes. Persistence
          verification failed.
        </p>
      )}
      <p>
        Prepare the home fixture before stop. Resume consumes another approved
        start and estimated allowance. Expiry does not block exact-owned stop or
        read-only recovery. Stopped resources may still incur charges.
      </p>
    </section>
  );
}
