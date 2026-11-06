import { useRef, useState } from "react";
import type { RegistryRecord } from "@fantastic.dev/convex-sandbox";

export function MachineDetailPanel({
  row,
  refresh,
}: {
  row: RegistryRecord | null | undefined;
  refresh: () => Promise<unknown>;
}) {
  const active = useRef(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  async function refreshObservation() {
    if (active.current) return;
    active.current = true;
    setPending(true);
    setFailed(false);
    try {
      await refresh();
    } catch {
      setFailed(true);
    } finally {
      active.current = false;
      setPending(false);
    }
  }
  if (row === undefined) return <p role="status">Loading owned machine…</p>;
  if (row === null)
    return (
      <section className="empty-state">
        <h2>Machine unavailable</h2>
        <p>
          This logical key has no authorized Boat binding in your workspace.
          Visiting a URL cannot establish ownership.
        </p>
      </section>
    );
  return (
    <section className="owned-machine-detail">
      <div className="detail-heading">
        <div>
          <p className="eyebrow">BOAT / {row.key}</p>
          <h2>Accepted observation</h2>
          <p className="machine-identity">
            Provider ID <code>{row.reference.providerId}</code>
          </p>
        </div>
        <span className="state-pill" data-testid="accepted-state">
          {row.observedState}
        </span>
      </div>
      <dl className="resource-grid">
        <div>
          <dt>CPU count</dt>
          <dd data-testid="cpu-value">
            {row.resources?.cpuCount ?? "Unknown"}
          </dd>
        </div>
        <div>
          <dt>Memory</dt>
          <dd data-testid="memory-value">
            {row.resources?.memoryMiB === undefined
              ? "Unknown"
              : `${row.resources.memoryMiB} MiB`}
          </dd>
        </div>
        <div>
          <dt>Disk</dt>
          <dd>
            {row.resources?.diskMiB === undefined
              ? "Unknown"
              : `${row.resources.diskMiB} MiB`}
          </dd>
        </div>
        <div>
          <dt>Requested state</dt>
          <dd>{row.requestedState ?? "None"}</dd>
        </div>
      </dl>
      <div className="observation-meta">
        <p>
          Refresh: {row.refresh.status}.{" "}
          {row.observedAt === undefined
            ? "No accepted observation yet."
            : `Last accepted ${new Date(row.observedAt).toLocaleString()}.`}
        </p>
        <p>
          Missing measurements stay unknown. Machine class is not a CPU or
          memory measurement.
        </p>
      </div>
      {(failed || row.refresh.status === "failed") && (
        <p className="feedback feedback-error" role="alert">
          Refresh failed. Showing the last accepted observation.{" "}
          {row.refresh.status === "failed"
            ? `Provider result: ${row.refresh.errorCode}.`
            : "Check operator access and server configuration, then retry."}
        </p>
      )}
      {row.refresh.status === "pending" && !pending && (
        <p role="status">
          A registry refresh is pending. A new bounded read can recover an
          interrupted request.
        </p>
      )}
      {row.tombstone ? (
        <p className="feedback">
          The component retains a deletion tombstone. This binding cannot be
          refreshed.
        </p>
      ) : (
        <button
          className="refresh-machine"
          type="button"
          disabled={pending}
          onClick={() => void refreshObservation()}
        >
          {pending ? "Refreshing observation…" : "Refresh observation"}
        </button>
      )}
      {pending && (
        <p role="status">Reading this owned machine through the component…</p>
      )}
      <p className="scope-note">
        One bounded native describe. No account scan, provisioning or lifecycle
        mutation.
      </p>
    </section>
  );
}
