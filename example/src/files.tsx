import { DeveloperExample } from "./developer-example";
import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useAction } from "convex/react";
import { api } from "../convex/_generated/api";
import { OperatorAccess } from "./operator-access";
import { FilesPanel } from "./files-panel";
import { validMachineKey } from "./machine-key";
function ConnectedFiles({ machineKey }: { machineKey: string }) {
  const row = useQuery(api.live.machines.get, { key: machineKey });
  const list = useAction(api.live.files.list),
    read = useAction(api.live.files.read),
    write = useAction(api.live.files.write),
    remove = useAction(api.live.files.remove);
  if (row === undefined) return <p>Loading owned binding…</p>;
  if (!row || row.tombstone)
    return (
      <p role="alert">
        No current owned Boat binding is available for this key.
      </p>
    );
  const target = {
    key: machineKey,
    generation: row.generation,
    providerId: row.reference.providerId,
  };
  return (
    <>
      <FilesPanel
        key={JSON.stringify(target)}
        machineKey={machineKey}
        actions={{
          list: () => list(target),
          read: (path) => read({ ...target, path }),
          write: (path, data, operationId) =>
            write({ ...target, path, data, operationId }),
          remove: (path, operationId) =>
            remove({ ...target, path, confirmPath: path, operationId }),
        }}
      />
      <Link
        to="/commands"
        search={{ machine: machineKey, operation: undefined }}
        className="text-link"
      >
        Open approved commands to prepare the directory →
      </Link>
    </>
  );
}
function ChooseFilesMachine() {
  const [key, setKey] = useState("");
  const navigate = useNavigate();
  return (
    <section className="setup-card">
      <h2>Choose an owned machine.</h2>
      <label className="command-field">
        Logical machine key
        <input
          value={key}
          maxLength={80}
          onChange={(e) => setKey(e.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={!validMachineKey(key)}
        onClick={() =>
          void navigate({ to: "/files", search: { machine: key } })
        }
      >
        Open owned files
      </button>
      <Link to="/machines" className="text-link">
        Browse owned machines →
      </Link>
    </section>
  );
}
export function FilesPage({ machineKey }: { machineKey?: string }) {
  return (
    <section className="workflow-page">
      <p className="eyebrow">BOAT / BOUNDED HOME FILES</p>
      <h1>Files</h1>
      <OperatorAccess>
        {machineKey && validMachineKey(machineKey) ? (
          <ConnectedFiles key={machineKey} machineKey={machineKey} />
        ) : (
          <ChooseFilesMachine />
        )}
      </OperatorAccess>
      <DeveloperExample workflow="files" />
    </section>
  );
}
