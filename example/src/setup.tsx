import { Link } from "@tanstack/react-router";
import { useAction, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { OperatorAccess } from "./operator-access";
import { SetupPanel } from "./setup-panel";
function ConnectedSetup() {
  const config = useQuery(api.live.setup.configuration, {});
  const check = useAction(api.live.setup.readiness);
  return (
    <>
      <SetupPanel configuration={config} check={() => check({})} />
      <Link className="primary-link" to="/setup/run">
        Review a bounded live run →
      </Link>
    </>
  );
}
export function SetupPage() {
  return (
    <section className="workflow-page">
      <p className="eyebrow">WORKSPACE / SETUP</p>
      <h1>Connect the example</h1>
      <OperatorAccess>
        <ConnectedSetup />
      </OperatorAccess>
    </section>
  );
}
