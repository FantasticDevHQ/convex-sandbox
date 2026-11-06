import { useAction, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { OperatorAccess } from "./operator-access";
import {
  SetupPanel,
  type SetupConfiguration,
  type SetupReadiness,
} from "./setup-panel";
const configuration = makeFunctionReference<
  "query",
  Record<string, never>,
  SetupConfiguration
>("live/setup:configuration");
const readiness = makeFunctionReference<
  "action",
  Record<string, never>,
  SetupReadiness
>("live/setup:readiness");
function ConnectedSetup() {
  const config = useQuery(configuration, {});
  const check = useAction(readiness);
  return <SetupPanel configuration={config} check={() => check({})} />;
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
