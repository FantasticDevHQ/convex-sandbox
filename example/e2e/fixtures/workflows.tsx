import { RecoveryPanel } from "../../src/recovery-panel";
import { MachineDetailPanel } from "../../src/machine-detail";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AllowancePanel } from "../../src/allowance-panel";
import { CreatePanel } from "../../src/create-panel";
import { FilesPanel } from "../../src/files-panel";
import { CommandsPanel } from "../../src/commands-panel";
import { LogsPanel } from "../../src/logs-panel";
import { LifecyclePanel } from "../../src/lifecycle-panel";
import { ForkPanel } from "../../src/fork-panel";
import { CatalogPanel } from "../../src/catalog-panel";
import { CleanupPanel } from "../../src/cleanup-panel";
import {
  OperatorGate,
  OperatorSessionProvider,
  type OperatorState,
} from "../../src/operator-gate";
import type { WorkflowSnapshot } from "../helpers/mounted-workflows";
import { encode, decode } from "../helpers/workflow-wire";
import "../../src/style.css";
declare global {
  interface Window {
    workflowRpc: (endpoint: string, args?: unknown) => Promise<unknown>;
  }
}
const key = "research-one",
  sourceKey = key,
  childKey = "research-child";
function Fixture() {
  const [snapshot, setSnapshot] = useState<WorkflowSnapshot>(),
    [workflow, setWorkflow] = useState(
      new URLSearchParams(location.search).get("workflow") ?? "Approval",
    );
  const access = new URLSearchParams(location.search).get(
    "access",
  ) as OperatorState | null;
  useEffect(() => {
    if (!access)
      void window
        .workflowRpc("snapshot", {})
        .then((reply) =>
          setSnapshot(
            (decode(reply) as { snapshot: WorkflowSnapshot }).snapshot,
          ),
        );
  }, [access]);
  async function send<T>(
    endpoint: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    const reply = decode(await window.workflowRpc(endpoint, encode(args))) as {
      result: T;
      snapshot: WorkflowSnapshot;
    };
    setSnapshot(reply.snapshot);
    return reply.result;
  }
  function target() {
    const row = snapshot?.creation.registry;
    if (!row) throw Error("No original binding");
    return {
      key,
      generation: row.generation,
      providerId: row.reference.providerId,
    };
  }
  const operationId = snapshot?.operationId ?? undefined;
  return (
    <main className="workbench workflow-page">
      <p>
        Offline browser qualification. Production panels and mounted
        application/component functions use synthetic HTTP only. No real
        credentials, authentication session or Boat resources.
      </p>
      <h1>Mounted offline workflows</h1>
      <OperatorSessionProvider>
        <OperatorGate
          state={access ?? "authorized"}
          onSignIn={() => {}}
          onSignOut={async () => {}}
        >
          <nav aria-label="Offline workflow">
            {[
              "Approval",
              "Create",
              "Files",
              "Commands",
              "Lifecycle",
              "Forks",
              "Catalog",
              "Recovery",
              "Cleanup",
            ].map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  setWorkflow(name);
                  history.replaceState(null, "", `?workflow=${name}`);
                }}
              >
                {name} workflow
              </button>
            ))}
          </nav>
          {!snapshot ? (
            <p role="status">Loading mounted endpoint state…</p>
          ) : (
            <>
              {workflow === "Approval" && (
                <AllowancePanel
                  review={snapshot.review}
                  approve={(reviewToken) =>
                    send("allowance:approve", {
                      reviewToken,
                      acknowledgeRisk: true,
                    })
                  }
                />
              )}
              {workflow === "Create" && (
                <>
                  <CreatePanel
                    selectedKey={key}
                    view={snapshot.creation}
                    request={() => send("create:create", { key })}
                  />
                  <MachineDetailPanel
                    row={snapshot.creation.registry}
                    refresh={() => send("machines:refresh", { key })}
                  />
                </>
              )}
              {workflow === "Files" && (
                <FilesPanel
                  machineKey={key}
                  actions={{
                    list: () => send("files:list", target()),
                    read: (path) => send("files:read", { ...target(), path }),
                    write: (path, data, operationId) =>
                      send("files:write", {
                        ...target(),
                        path,
                        data,
                        operationId,
                      }),
                    remove: (path, operationId) =>
                      send("files:remove", {
                        ...target(),
                        path,
                        confirmPath: path,
                        operationId,
                      }),
                  }}
                />
              )}
              {workflow === "Commands" && (
                <>
                  <CommandsPanel
                    key={operationId ?? "compose"}
                    machineKey={key}
                    operationId={operationId}
                    record={snapshot.record}
                    start={(input, operationId) =>
                      send("commands:start", { key, operationId, input })
                    }
                    inspect={() =>
                      send("commands:inspect", { key, operationId })
                    }
                  />
                  {snapshot.record && (
                    <LogsPanel
                      record={snapshot.record}
                      cache={snapshot.cache}
                      sync={() => send("logs:sync", { key, operationId })}
                    />
                  )}
                </>
              )}
              {workflow === "Lifecycle" && (
                <LifecyclePanel
                  view={snapshot.lifecycle}
                  request={(action, operationId) =>
                    send(
                      action === "prepare"
                        ? "lifecycle:prepareFixture"
                        : action === "inspect"
                          ? "lifecycle:inspect"
                          : "lifecycle:run",
                      action === "prepare" || action === "inspect"
                        ? { key }
                        : { key, action, operationId },
                    )
                  }
                />
              )}
              {workflow === "Forks" && (
                <ForkPanel
                  view={snapshot.fork}
                  sourceKey={sourceKey}
                  childKey={childKey}
                  request={(action) =>
                    send(`fork:${action}`, { sourceKey, childKey })
                  }
                />
              )}
              {workflow === "Catalog" && (
                <CatalogPanel
                  sourceKey={sourceKey}
                  load={() => send("catalog:load", target())}
                />
              )}
              {workflow === "Recovery" && (
                <RecoveryPanel
                  machineKey={key}
                  context={snapshot.recovery}
                  operations={snapshot.operations}
                  inspect={(op) =>
                    send("recovery:inspect", {
                      key,
                      operationId: op.operationId,
                      generation: op.generation,
                      providerId: op.reference.providerId,
                    })
                  }
                />
              )}
              {workflow === "Cleanup" && snapshot.cleanup && (
                <CleanupPanel
                  view={snapshot.cleanup}
                  request={(confirmation, reviewToken) =>
                    send("cleanup:requestNext", {
                      runId: "offline-run",
                      confirmation,
                      reviewToken,
                    })
                  }
                  inspect={() =>
                    send("cleanup:inspectNext", { runId: "offline-run" })
                  }
                  reset={async () => {
                    throw Error(
                      "Offline scenario never erases recovery records",
                    );
                  }}
                />
              )}
            </>
          )}
        </OperatorGate>
      </OperatorSessionProvider>
    </main>
  );
}
const root = document.getElementById("root");
if (!root) throw Error("No root");
createRoot(root).render(<Fixture />);
