import { DeveloperExample } from "./developer-example";
import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useAction, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { OperatorAccess } from "./operator-access";
import { CommandsPanel } from "./commands-panel";
import { ConnectedLogs } from "./logs";
import { validMachineKey } from "./machine-key";
function ChooseMachine() {
  const [key, setKey] = useState("");
  const navigate = useNavigate();
  return (
    <section className="setup-card">
      <h2>Choose an owned machine.</h2>
      <label className="machine-key-field">
        Logical machine key
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="research-one"
          maxLength={80}
        />
      </label>
      <button
        type="button"
        disabled={!validMachineKey(key)}
        onClick={() =>
          void navigate({
            to: "/commands",
            search: { machine: key, operation: undefined },
          })
        }
      >
        Open owned commands
      </button>
      <Link to="/machines" className="text-link">
        Browse owned machines →
      </Link>
    </section>
  );
}
export function ConnectedCommands({
  machineKey,
  operationId,
}: {
  machineKey: string;
  operationId?: string;
}) {
  const validOperation =
    !operationId || /^command-[a-zA-Z0-9_-]{1,80}$/.test(operationId);
  const record = useQuery(
    api.live.commands.get,
    operationId && validOperation ? { key: machineKey, operationId } : "skip",
  );
  const { results, status, loadMore } = usePaginatedQuery(
    api.live.commands.list,
    { key: machineKey },
    { initialNumItems: 20 },
  );
  const start = useAction(api.live.commands.start),
    inspect = useAction(api.live.commands.inspect);
  const navigate = useNavigate();
  if (!validOperation)
    return (
      <p role="alert">
        The URL has an invalid command identity. Choose a retained operation
        from its original link.
      </p>
    );
  return (
    <>
      <CommandsPanel
        machineKey={machineKey}
        operationId={operationId}
        record={record}
        start={async (input, id) => {
          await navigate({
            to: "/commands",
            search: { machine: machineKey, operation: id },
          });
          return start({ key: machineKey, operationId: id, input });
        }}
        inspect={() =>
          operationId
            ? inspect({ key: machineKey, operationId })
            : Promise.resolve(null)
        }
      />
      {record && (
        <ConnectedLogs
          key={JSON.stringify([
            record.key,
            record.operationId,
            record.generation,
            record.reference,
          ])}
          record={record}
        />
      )}
      <section className="setup-card">
        <h2>Retained command history</h2>
        <p>
          {results.length} loaded for this binding. History is bounded by the
          component.
        </p>
        {results.map((op) => (
          <p key={op.operationId}>
            <Link
              className="text-link"
              to="/commands"
              search={{ machine: machineKey, operation: op.operationId }}
            >
              {op.operationId}
            </Link>{" "}
            · {op.status}
          </p>
        ))}
        {status !== "Exhausted" && (
          <button
            type="button"
            disabled={status === "LoadingMore"}
            onClick={() => loadMore(20)}
          >
            Load more command history
          </button>
        )}
        <Link
          className="text-link"
          to="/commands"
          search={{ machine: machineKey, operation: undefined }}
        >
          Compose a new command →
        </Link>
      </section>
    </>
  );
}
export function CommandsPage({
  machineKey,
  operationId,
}: {
  machineKey?: string;
  operationId?: string;
}) {
  return (
    <section className="workflow-page">
      <p className="eyebrow">BOAT / DETACHED COMMANDS</p>
      <h1>Run a command</h1>
      <OperatorAccess>
        {machineKey && validMachineKey(machineKey) ? (
          <ConnectedCommands
            key={machineKey}
            machineKey={machineKey}
            operationId={operationId}
          />
        ) : (
          <ChooseMachine />
        )}
      </OperatorAccess>
      <DeveloperExample workflow="logs" />
    </section>
  );
}
