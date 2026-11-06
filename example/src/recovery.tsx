import { useState } from "react";
import { useQuery, useAction, usePaginatedQuery } from "convex/react";
import { useNavigate } from "@tanstack/react-router";
import { api } from "../convex/_generated/api";
import { OperatorAccess } from "./operator-access";
import { validMachineKey } from "./machine-key";
import { RecoveryPanel } from "./recovery-panel";
function Choose() {
  const [key, setKey] = useState("");
  const navigate = useNavigate();
  return (
    <section className="setup-card">
      <h2>Reopen an original machine key.</h2>
      <p>
        Use the exact logical key from its retained URL or reviewed run. Unbound
        creations and unknown forks are retained too.
      </p>
      <label className="machine-key-field">
        Logical machine key
        <input
          maxLength={80}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="research-one"
        />
      </label>
      <button
        type="button"
        disabled={!validMachineKey(key)}
        onClick={() =>
          void navigate({
            to: "/operations",
            search: { machine: key, operation: undefined },
          })
        }
      >
        Open retained operations
      </button>
    </section>
  );
}
function Connected({
  machineKey,
  operationId,
}: {
  machineKey: string;
  operationId?: string;
}) {
  const context = useQuery(api.live.recovery.context, { key: machineKey });
  const selected = useQuery(
    api.live.recovery.get,
    operationId ? { key: machineKey, operationId } : "skip",
  );
  const { results, status, loadMore } = usePaginatedQuery(
    api.live.recovery.list,
    { key: machineKey },
    { initialNumItems: 20 },
  );
  const inspect = useAction(api.live.recovery.inspect);
  if (!context) return <p role="status">Loading retained work…</p>;
  const operations =
    selected && !results.some((op) => op.operationId === selected.operationId)
      ? [selected, ...results]
      : results;
  return (
    <>
      {operationId && selected === null && (
        <p role="alert">
          The selected operation is not retained in this operator scope.
        </p>
      )}
      <RecoveryPanel
        machineKey={machineKey}
        context={context}
        operations={operations}
        inspect={(op) =>
          inspect({
            key: machineKey,
            operationId: op.operationId,
            generation: op.generation,
            providerId: op.reference.providerId,
          })
        }
      />
      {status !== "Exhausted" && (
        <button
          type="button"
          disabled={status !== "CanLoadMore"}
          onClick={() => loadMore(20)}
        >
          Load more retained history
        </button>
      )}
    </>
  );
}
export function RecoveryPage({
  machineKey,
  operationId,
}: {
  machineKey?: string;
  operationId?: string;
}) {
  return (
    <section className="workflow-page">
      <p className="eyebrow">BOAT / RECOVERY</p>
      <h1>Operations</h1>
      <OperatorAccess>
        {machineKey && validMachineKey(machineKey) ? (
          <Connected
            key={machineKey}
            machineKey={machineKey}
            operationId={operationId}
          />
        ) : (
          <Choose />
        )}
      </OperatorAccess>
    </section>
  );
}
