import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useAction } from "convex/react";
import { api } from "../convex/_generated/api";
import { OperatorAccess } from "./operator-access";
import { ForkPanel } from "./fork-panel";
import { validMachineKey } from "./machine-key";
function ConnectedFork({
  sourceKey,
  childKey,
}: {
  sourceKey: string;
  childKey: string;
}) {
  const input = { sourceKey, childKey };
  const view = useQuery(api.live.fork.status, input),
    start = useAction(api.live.fork.start),
    inspect = useAction(api.live.fork.inspect),
    verify = useAction(api.live.fork.verify);
  return (
    <>
      <ForkPanel
        sourceKey={sourceKey}
        childKey={childKey}
        view={view}
        request={(kind) => ({ start, inspect, verify })[kind](input)}
      />
      <div className="file-actions">
        <Link
          to="/machines/$machineId"
          params={{ machineId: sourceKey }}
          className="text-link"
        >
          Source fixture and stop →
        </Link>
        {view?.intent?.childId && (
          <Link
            to="/machines/$machineId"
            params={{ machineId: childKey }}
            className="text-link"
          >
            Child lifecycle and cleanup →
          </Link>
        )}
        <Link to="/setup/run" className="text-link">
          Reviewed run allowance →
        </Link>
      </div>
    </>
  );
}
function ChooseFork({ sourceKey }: { sourceKey?: string }) {
  const [source, setSource] = useState(sourceKey ?? ""),
    [child, setChild] = useState("");
  const navigate = useNavigate();
  return (
    <section className="setup-card">
      <h2>Choose the stopped source and a new child key.</h2>
      <label className="command-field">
        Source machine key
        <input
          value={source}
          maxLength={80}
          onChange={(e) => setSource(e.target.value)}
        />
      </label>
      <label className="command-field">
        New child machine key
        <input
          value={child}
          maxLength={80}
          onChange={(e) => setChild(e.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={
          !validMachineKey(source) ||
          !validMachineKey(child) ||
          source === child
        }
        onClick={() =>
          void navigate({ to: "/forks", search: { source, child } })
        }
      >
        Review stopped-source fork
      </button>
      <p>
        Opening a plan starts no native work. An unknown prior fork remains
        unresolved until its exact intent can be reconciled.
      </p>
    </section>
  );
}
export function ForkPage({
  sourceKey,
  childKey,
}: {
  sourceKey?: string;
  childKey?: string;
}) {
  const selected =
    sourceKey &&
    childKey &&
    validMachineKey(sourceKey) &&
    validMachineKey(childKey) &&
    sourceKey !== childKey;
  return (
    <section className="workflow-page">
      <p className="eyebrow">BOAT / STOPPED SOURCE FORK</p>
      <h1>Fork a stopped source</h1>
      <OperatorAccess>
        {selected ? (
          <ConnectedFork
            key={JSON.stringify([sourceKey, childKey])}
            sourceKey={sourceKey}
            childKey={childKey}
          />
        ) : (
          <ChooseFork sourceKey={sourceKey} />
        )}
      </OperatorAccess>
    </section>
  );
}
