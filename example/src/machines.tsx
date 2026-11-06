import { Link } from "@tanstack/react-router";
import { useAction, usePaginatedQuery, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import type { RegistryRecord } from "@fantastic.dev/convex-sandbox";
import { OperatorAccess } from "./operator-access";
import { MachineDetailPanel } from "./machine-detail";
const listQuery = makeFunctionReference<
  "query",
  { paginationOpts: { cursor: string | null; numItems: number } },
  {
    page: RegistryRecord[];
    isDone: boolean;
    continueCursor: string;
    partial: boolean;
  }
>("live/machines:list");
const getQuery = makeFunctionReference<
  "query",
  { key: string },
  RegistryRecord | null
>("live/machines:get");
const refreshAction = makeFunctionReference<
  "action",
  { key: string },
  RegistryRecord
>("live/machines:refresh");
function ConnectedList() {
  const { results, status, loadMore } = usePaginatedQuery(
    listQuery,
    {},
    { initialNumItems: 20 },
  );
  if (status === "LoadingFirstPage")
    return <p role="status">Loading owned Boat bindings…</p>;
  return (
    <>
      <p className="lede">
        Reactive component observations for your authorized workspace.{" "}
        {results.length} loaded.
      </p>
      {results.length === 0 ? (
        <section className="empty-state">
          <h2>No owned Boat machines</h2>
          <p>
            This workspace has no authorized Boat bindings on this page. The app
            does not scan your native account or create fixture machines here.
          </p>
          <Link to="/setup" className="text-link">
            Review setup →
          </Link>
        </section>
      ) : (
        <div className="owned-machine-list">
          {results.map((row) => (
            <article key={row.key} className="owned-machine-card">
              <div className="detail-heading">
                <h2>{row.key}</h2>
                <span className="state-pill">{row.observedState}</span>
              </div>
              <p>
                CPU: {row.resources?.cpuCount ?? "Unknown"} · Memory:{" "}
                {row.resources?.memoryMiB === undefined
                  ? "Unknown"
                  : `${row.resources.memoryMiB} MiB`}
              </p>
              <p className="scope-note">
                Refresh: {row.refresh.status}
                {row.tombstone ? " · Deletion tombstone retained" : ""}
              </p>
              <Link
                to="/machines/$machineId"
                params={{ machineId: row.key }}
                className="text-link"
              >
                Open details →
              </Link>
            </article>
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
  const row = useQuery(getQuery, { key: machineKey });
  const refresh = useAction(refreshAction);
  return (
    <MachineDetailPanel
      key={machineKey}
      row={row}
      refresh={() => refresh({ key: machineKey })}
    />
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
