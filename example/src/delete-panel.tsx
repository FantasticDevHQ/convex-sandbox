import { useRef, useState } from "react";
import type { DeleteView } from "../convex/live/delete";
type DeletePanelProps = {
  view: DeleteView | undefined;
  request: (confirmation: string, reviewToken: string) => Promise<unknown>;
  inspect: () => Promise<unknown>;
};
export function DeletePanel(props: DeletePanelProps) {
  return (
    <ConfirmationPanel key={props.view?.reviewToken ?? "loading"} {...props} />
  );
}
function ConfirmationPanel({ view, request, inspect }: DeletePanelProps) {
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  async function submit(remove: boolean) {
    if (busy.current || !view?.row) return;
    if (
      remove &&
      (confirmation !== view.row.key ||
        !view.reviewToken ||
        view.operation ||
        view.row.tombstone)
    )
      return;
    busy.current = true;
    setPending(true);
    setFailed(false);
    try {
      if (remove) await request(confirmation, view.reviewToken ?? "");
      else await inspect();
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  if (!view) return <p role="status">Loading owned cleanup record…</p>;
  if (!view.row) return <p>No authorized Boat binding exists for deletion.</p>;
  const { row, operation, phase } = view;
  const label = {
    not_requested: "Not requested",
    pending: "Pending cleanup",
    unresolved: "Cleanup unresolved",
    confirmed: "Confirmed deletion",
  }[phase];
  return (
    <section className="setup-card deletion-panel">
      <span className="step">CLEANUP / EXACT OWNED TARGET</span>
      <h2>Delete {row.key}</h2>
      <p>
        This removes the selected machine and its retained data. Review the
        exact owned target before confirming.
      </p>
      <dl className="setup-facts">
        <div>
          <dt>Logical key</dt>
          <dd>{row.key}</dd>
        </div>
        <div>
          <dt>Bound provider ID</dt>
          <dd>{row.reference.providerId}</dd>
        </div>
        <div>
          <dt>Generation</dt>
          <dd>{row.generation}</dd>
        </div>
        <div>
          <dt>Delete status</dt>
          <dd data-testid="delete-phase">{label}</dd>
        </div>
      </dl>
      {!operation && !row.tombstone && (
        <div>
          <label className="machine-key-field">
            Type {row.key} to confirm
            <input
              value={confirmation}
              disabled={pending}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="off"
            />
          </label>
          <button
            className="destructive-button"
            type="button"
            disabled={
              pending ||
              confirmation !== row.key ||
              Boolean(row.activeOperationId)
            }
            onClick={() => void submit(true)}
          >
            {pending ? "Requesting exact deletion…" : "Delete selected machine"}
          </button>
          {row.activeOperationId && (
            <p>Inspect the unfinished operation before requesting deletion.</p>
          )}
        </div>
      )}
      {operation && (
        <div aria-live="polite">
          <p>
            Original operation: <code>{operation.operationId}</code>
          </p>
          <p>
            {phase === "confirmed"
              ? "The matching native deletion job completed. The registry tombstone is retained."
              : "Acceptance is pending cleanup until its matching native job completes. A 404 or an accepted DELETE is not completion."}
          </p>
          {phase !== "confirmed" && (
            <button
              type="button"
              disabled={pending}
              onClick={() => void submit(false)}
            >
              {pending
                ? "Inspecting original job…"
                : "Inspect original deletion"}
            </button>
          )}
        </div>
      )}
      {(failed || phase === "unresolved") && (
        <p role="alert">
          Cleanup remains unresolved. Keep the original operation and known
          target; missing replies or wrong-target responses do not confirm
          deletion. No replacement DELETE is issued by inspection.
        </p>
      )}
      {phase === "confirmed" && (
        <p className="confirmed-cleanup" role="status">
          Confirmed deletion of this exact owned fixture. Retained operation and
          tombstone records remain available.
        </p>
      )}
      <p>
        Recovery remains available after admission expiry. This view does not
        scan or delete other account resources, release unknown child
        reservations or reset journals.
      </p>
    </section>
  );
}
