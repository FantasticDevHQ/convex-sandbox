import { ConnectedLifecycle } from "./lifecycle";
import { MachineCard } from "./machine-card";
import { Link } from "@tanstack/react-router";
import { useAction, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { OperatorAccess } from "./operator-access";
import { MachineDetailPanel } from "./machine-detail";
function ConnectedList() {
  const { results, status, loadMore } = usePaginatedQuery(
    api.live.machines.list,
    {},
    { initialNumItems: 20 },
  );
  if (status === "LoadingFirstPage")
    return <p role="status">Loading owned Boat bindings…</p>;
  return (
    <>
      <Link
        to="/machines/new"
        search={{ key: undefined }}
        className="primary-link"
      >
        Create an approved test machine →
      </Link>
      <p className="lede">
        Reactive component observations for your authorized workspace.{" "}
        {results.length} loaded.
      </p>
      {results.length === 0 ? (
        <section className="empty-state">
          <h2>No owned Boat machines</h2>
          <p>
            This workspace has no authorized Boat bindings on this page. The app
            does not scan your native account. Creation needs an approved run.
          </p>
          <Link to="/setup" className="text-link">
            Review setup →
          </Link>
        </section>
      ) : (
        <div className="owned-machine-list">
          {results.map((row) => (
            <MachineCard key={row.key} row={row}>
              <Link
                to="/machines/$machineId"
                params={{ machineId: row.key }}
                className="text-link"
              >
                Open details →
              </Link>
            </MachineCard>
          ))}
        </div>
      )}
      {status !== "Exhausted" && (
        <button
          className="refresh-machine"
          type="button"
          disabled={status === "LoadingMore"}
          onClick={() => loadMore(20)}
        >
          {status === "LoadingMore" ? "Loading…" : "Load more owned machines"}
        </button>
      )}
    </>
  );
}
function ConnectedDetail({ machineKey }: { machineKey: string }) {
  const row = useQuery(api.live.machines.get, { key: machineKey });
  const refresh = useAction(api.live.machines.refresh);
  return (
    <>
      <MachineDetailPanel
        key={machineKey}
        row={row}
        refresh={() => refresh({ key: machineKey })}
      />
      <ConnectedLifecycle key={machineKey} machineKey={machineKey} />
    </>
  );
}
export function MachinesPage() {
  return (
    <section className="workflow-page">
      <p className="eyebrow">WORKSPACE / MACHINES</p>
      <h1>Owned machines</h1>
      <OperatorAccess>
        <ConnectedList />
      </OperatorAccess>
    </section>
  );
}
export function MachinePage({ machineKey }: { machineKey: string }) {
  return (
    <section className="workflow-page">
      <p className="eyebrow">WORKSPACE / MACHINES</p>
      <h1>Machine details</h1>
      <code>{machineKey}</code>
      <OperatorAccess>
        <ConnectedDetail machineKey={machineKey} />
      </OperatorAccess>
      <Link to="/machines" className="text-link">
        ← Back to owned machines
      </Link>
    </section>
  );
}
