import type { ReactNode } from "react";
import type { RegistryRecord } from "@fantastic.dev/convex-sandbox";

export function MachineCard({
  row,
  children,
}: {
  row: RegistryRecord;
  children: ReactNode;
}) {
  return (
    <article className="owned-machine-card">
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
      {children}
    </article>
  );
}
