import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import type { Capabilities } from "@fantastic.dev/convex-sandbox";
import { api } from "../convex/_generated/api";
import type { Profile } from "./playground";
import type { Task } from "./use-task";
import { CommandPanel, FilesPanel } from "./playground-panels";

export function Machine({
  profile,
  task,
  capabilities,
}: {
  profile: Profile;
  task: Task;
  capabilities?: Capabilities;
}) {
  const row = useQuery(api.demo.get, { profile });
  const lifecycle = useAction(api.demo.lifecycle);
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!row) return <p role="status">Loading machine…</p>;
  if (row.tombstone)
    return (
      <section className="empty-state">
        <h2>{profile} is deleted</h2>
        <p>
          The component retained its tombstone. Reset demo data to create a new
          fixture epoch.
        </p>
      </section>
    );
  const supports = (capability: Capabilities["supported"][number]) =>
    capabilities?.supported.includes(capability) ?? false;
  const run = (action: "start" | "stop" | "delete") =>
    task.run(`${action} ${profile}`, () =>
      lifecycle({ profile, action, operationId: crypto.randomUUID() }),
    );
  return (
    <>
      <div className="detail-heading">
        <div>
          <p className="eyebrow">SIMULATED MACHINE</p>
          <h2>{profile}</h2>
          <code>{row.reference.providerId}</code>
        </div>
        <span className="state-pill">{row.observedState}</span>
      </div>
      <dl className="resource-grid">
        <div>
          <dt>Fixture CPU</dt>
          <dd>{row.resources?.cpuCount ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Fixture memory</dt>
          <dd>{row.resources?.memoryMiB ?? "Unknown"} MiB</dd>
        </div>
        <div>
          <dt>Disk on stop</dt>
          <dd>{capabilities?.persistence?.diskOnStop ?? "unknown"}</dd>
        </div>
        <div>
          <dt>Memory on stop</dt>
          <dd>{capabilities?.persistence?.memoryOnStop ?? "unknown"}</dd>
        </div>
      </dl>
      <p className="scope-note">
        Synthetic resource metadata. No compute is allocated.
      </p>
      <div className="button-row lifecycle-controls">
        <button
          type="button"
          disabled={
            !!task.pending ||
            row.observedState === "running" ||
            !(supports("start") || supports("resumeMemory"))
          }
          onClick={() => void run("start")}
        >
          Start / resume
        </button>
        <button
          type="button"
          disabled={
            !!task.pending ||
            row.observedState !== "running" ||
            !(supports("stop") || supports("suspendMemory"))
          }
          onClick={() => void run("stop")}
        >
          Stop / pause
        </button>
        <button
          type="button"
          className="danger"
          disabled={!!task.pending || !supports("delete")}
          onClick={() => setConfirmDelete(true)}
        >
          Delete machine
        </button>
      </div>
      {confirmDelete && (
        <fieldset className="feedback" aria-label="Confirm machine deletion">
          <p>
            Delete this simulated machine? Reset is required to recreate it.
          </p>
          <div className="button-row">
            <button
              type="button"
              className="danger"
              disabled={!!task.pending}
              onClick={() => void run("delete")}
            >
              Confirm delete
            </button>
            <button
              type="button"
              disabled={!!task.pending}
              onClick={() => setConfirmDelete(false)}
            >
              Keep machine
            </button>
          </div>
        </fieldset>
      )}
      <CommandPanel
        profile={profile}
        task={task}
        running={row.observedState === "running"}
        supported={supports("execute")}
      />
      <FilesPanel
        profile={profile}
        task={task}
        supported={supports("readFile") && supports("writeFile")}
      />
      <ImagePanel
        profile={profile}
        task={task}
        snapshotSupported={supports("snapshotDisk")}
        connectionSupported={supports("getConnection")}
      />
      <details className="capability-details">
        <summary>
          Declared capabilities ({capabilities?.supported.length ?? 0})
        </summary>
        <p>{capabilities?.supported.join(" · ")}</p>
        <p>
          Capabilities describe the synthetic adapter. They do not certify a
          live provider.
        </p>
      </details>
    </>
  );
}
function ImagePanel({
  profile,
  task,
  snapshotSupported,
  connectionSupported,
}: {
  profile: Profile;
  task: Task;
  snapshotSupported: boolean;
  connectionSupported: boolean;
}) {
  const snapshot = useAction(api.demo.snapshot),
    status = useAction(api.demo.snapshotStatus),
    connection = useAction(api.demo.connection);
  const history = useQuery(api.demo.history, {
    profile,
    paginationOpts: { cursor: null, numItems: 10 },
  });
  const [handle, setHandle] = useState<string | null>(null);
  const latest = history?.page.find((row) => row.kind === "snapshotDisk");
  return (
    <section className="operation-panel">
      <div className="panel-heading">
        <h3>Snapshots & connections</h3>
        <span className="step">NATIVE FIXTURES</span>
      </div>
      <p>
        These demonstrate metadata and readiness. Connection handles use
        .invalid URLs and cannot open a desktop.
      </p>
      <div className="button-row">
        <button
          type="button"
          disabled={!!task.pending || !snapshotSupported}
          onClick={() =>
            void task.run("Create snapshot", () =>
              snapshot({ profile, operationId: crypto.randomUUID() }),
            )
          }
        >
          Create snapshot
        </button>
        <button
          type="button"
          disabled={
            !!task.pending ||
            !latest ||
            !["running", "unknown"].includes(latest.status)
          }
          onClick={() => {
            if (latest)
              void task.run("Check snapshot", () =>
                status({ profile, operationId: latest.operationId }),
              );
          }}
        >
          Check snapshot
        </button>
        <button
          type="button"
          disabled={!!task.pending || !connectionSupported}
          onClick={() =>
            void task.run("Get preview handle", async () => {
              const result = await connection({ profile, kind: "preview" });
              setHandle(JSON.stringify(result, null, 2));
            })
          }
        >
          Get preview handle
        </button>
      </div>
      {!snapshotSupported && (
        <p className="scope-note">
          Unsupported: this profile does not advertise disk snapshots.
        </p>
      )}
      {!connectionSupported && (
        <p className="scope-note">
          Unsupported: this profile does not advertise connections.
        </p>
      )}
      {latest && (
        <p role="status">
          Snapshot: <strong>{latest.status}</strong> ·{" "}
          {latest.nativeImage?.result
            ? "native result recorded"
            : "no native result yet"}
        </p>
      )}
      {handle && (
        <section aria-label="Nonfunctional connection handle">
          <pre className="result-code">{handle}</pre>
        </section>
      )}
      <details>
        <summary>Public API</summary>
        <pre>
          <code>
            {
              'providers.images(createImageStore(ctx, components.sandbox))\n  .run({ sandbox, operationId, kind: "snapshotDisk" });\n// Reconcile pending native jobs with .status(handle).'
            }
          </code>
        </pre>
      </details>
    </section>
  );
}
