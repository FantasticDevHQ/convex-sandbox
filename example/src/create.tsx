import { useAction, useQuery } from "convex/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { api } from "../convex/_generated/api";
import { OperatorAccess } from "./operator-access";
import { CreatePanel } from "./create-panel";
function ConnectedCreate({ machineKey }: { machineKey?: string }) {
  const view = useQuery(
    api.live.create.status,
    machineKey ? { key: machineKey } : "skip",
  );
  const create = useAction(api.live.create.create);
  const navigate = useNavigate();
  return (
    <>
      <CreatePanel
        key={machineKey ?? "new"}
        selectedKey={machineKey}
        view={view}
        request={async (key) => {
          await navigate({ to: "/machines/new", search: { key } });
          return create({ key });
        }}
      />
      {machineKey && view?.registry && (
        <Link
          to="/machines/$machineId"
          params={{ machineId: machineKey }}
          className="primary-link"
        >
          Inspect owned machine →
        </Link>
      )}
      <Link to="/setup/run" className="text-link">
        Review run approval →
      </Link>
    </>
  );
}
export function CreatePage({ machineKey }: { machineKey?: string }) {
  return (
    <section className="workflow-page">
      <p className="eyebrow">BOAT / CREATE</p>
      <h1>Create a test machine</h1>
      <OperatorAccess>
        <ConnectedCreate machineKey={machineKey} />
      </OperatorAccess>
    </section>
  );
}
