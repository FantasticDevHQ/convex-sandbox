import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CommandsPanel } from "../../src/commands-panel";
import type { ExecutionRecord } from "@fantastic.dev/convex-sandbox";
import "../../src/style.css";
const selected =
  new URL(location.href).searchParams.get("operation") ?? undefined;
function Fixture() {
  const [operation, setOperation] = useState(selected),
    [record, setRecord] = useState<ExecutionRecord | null>(() =>
      selected
        ? JSON.parse(
            localStorage.getItem(`synthetic-command:${selected}`) ?? "null",
          )
        : null,
    );
  const [count, setCount] = useState(
    Number(localStorage.getItem("synthetic-command-starts") ?? 0),
  );
  const save = (value: ExecutionRecord) => {
    setRecord(value);
    localStorage.setItem(
      `synthetic-command:${value.operationId}`,
      JSON.stringify(value),
    );
  };
  return (
    <main className="workbench workflow-page">
      <p>
        Offline UI test. Synthetic command history and replies; no Boat calls or
        guest execution.
      </p>
      <h1>Run a command</h1>
      <p>
        Synthetic start callbacks:{" "}
        <output data-testid="synthetic-command-count">{count}</output>
      </p>
      <CommandsPanel
        machineKey="research-one"
        operationId={operation}
        record={record}
        start={async (_input, id) => {
          setCount((n) => n + 1);
          localStorage.setItem("synthetic-command-starts", String(count + 1));
          setOperation(id);
          const url = new URL(location.href);
          url.searchParams.set("operation", id);
          history.replaceState(null, "", url);
          await new Promise((resolve) => setTimeout(resolve, 100));
          if (location.search.includes("fail"))
            throw Error("Synthetic refusal");
          const lost = location.search.includes("unknown");
          save({
            scope: "example-boat:synthetic",
            key: "research-one",
            operationId: id,
            reference: { provider: "boat", providerId: "synthetic-native" },
            generation: 1,
            version: 2,
            ...(!lost ? { executionId: "synthetic-native-history" } : {}),
            state: lost ? "unknown" : "running",
            idempotency: "none",
            cancellation: { requested: false, acknowledgement: "none" },
            outputBytes: 0,
            outputTruncated: false,
            createdAt: 0,
            updatedAt: 0,
          });
        }}
        inspect={async () => {
          if (record && record.executionId)
            save({ ...record, state: "completed", exitCode: 17 });
        }}
      />
    </main>
  );
}
const root = document.getElementById("root");
if (!root) throw Error("No root");
createRoot(root).render(<Fixture />);
