import { useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  CachedLogPage,
  ExecutionRecord,
} from "@fantastic.dev/convex-sandbox";
import { LogsPanel } from "../../src/logs-panel";
import "../../src/style.css";
const record: ExecutionRecord = {
  scope: "example-boat:synthetic",
  key: "research-one",
  operationId: "command-one",
  generation: 1,
  reference: { provider: "boat", providerId: "synthetic-native" },
  version: 1,
  executionId: "synthetic-history",
  state: "running",
  idempotency: "none",
  cancellation: { requested: false, acknowledgement: "none" },
  outputBytes: 6,
  outputTruncated: false,
  createdAt: 0,
  updatedAt: 0,
};
const initial: CachedLogPage = {
  entries: [{ sequence: 0, stream: "stdout", text: "hello\n" }],
  nextCursor: 0,
  isDone: true,
  truncated: false,
};
function Fixture() {
  const [cache, setCache] = useState<CachedLogPage>(
    () =>
      JSON.parse(localStorage.getItem("synthetic-log-cache") ?? "null") ??
      initial,
  );
  const [count, setCount] = useState(0),
    [cursor, setCursor] = useState<number | null>(null);
  return (
    <main className="workbench workflow-page">
      <p>
        Offline UI test. Synthetic cache and cursor, no native logs or Boat
        calls.
      </p>
      <h1>Read command output</h1>
      <p>
        Synthetic refresh callbacks:{" "}
        <output data-testid="log-call-count">{count}</output>. Last requested
        cache cursor:{" "}
        <output data-testid="log-requested-cursor">{cursor ?? "none"}</output>
      </p>
      <LogsPanel
        record={record}
        cache={cache}
        sync={async () => {
          setCount((n) => n + 1);
          setCursor(cache.nextCursor);
          if (location.search.includes("fail"))
            throw Error("Synthetic output read refusal");
          const updated: CachedLogPage = {
            entries: [
              initial.entries[0],
              { sequence: 1, stream: "stdout", text: "world\n" },
            ],
            nextCursor: 1,
            isDone: true,
            truncated: location.search.includes("truncated"),
          };
          setCache(updated);
          localStorage.setItem("synthetic-log-cache", JSON.stringify(updated));
        }}
      />
    </main>
  );
}
const root = document.getElementById("root");
if (!root) throw Error("No root");
createRoot(root).render(<Fixture />);
