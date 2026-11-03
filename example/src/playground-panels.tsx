import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Profile } from "./playground";
import type { Task } from "./use-task";

type Scenario =
  | "hello"
  | "background"
  | "large-output"
  | "nonzero"
  | "lost-reply"
  | "rejected";
const scenarios: { value: Scenario; label: string }[] = [
  { value: "hello", label: "Hello / completed" },
  { value: "background", label: "Background / cancellation" },
  { value: "large-output", label: "Large output / pagination" },
  { value: "nonzero", label: "Exit code 7" },
  { value: "lost-reply", label: "Lost reply / unknown outcome" },
  { value: "rejected", label: "Rejected / not started" },
];
export function CommandPanel({
  profile,
  task,
  running,
  supported,
}: {
  profile: Profile;
  task: Task;
  running: boolean;
  supported: boolean;
}) {
  const [scenario, setScenario] = useState<Scenario>("hello");
  const [operationId, setOperationId] = useState<string | null>(null);
  const execute = useAction(api.demo.execute),
    status = useAction(api.demo.status),
    cancel = useAction(api.demo.cancel);
  const execution = useQuery(
    api.demo.execution,
    operationId ? { profile, operationId } : "skip",
  );
  const history = useQuery(api.demo.history, {
    profile,
    paginationOpts: { cursor: null, numItems: 10 },
  });
  const active =
    execution &&
    ["reserved", "queued", "running", "unknown"].includes(execution.state);
  return (
    <section className="operation-panel">
      <div className="panel-heading">
        <h3>Command lab</h3>
        <span className="step">FIXED SCENARIOS</span>
      </div>
      <p>
        Commands run in a bounded fixture interpreter. Status checks advance
        background fixtures; there is no shell or background poller.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const id = crypto.randomUUID();
          setOperationId(id);
          void task.run("Run fixture", () =>
            execute({ profile, operationId: id, scenario }),
          );
        }}
      >
        <label htmlFor="scenario">Command scenario</label>
        <div className="input-row">
          <select
            id="scenario"
            value={scenario}
            disabled={!!task.pending}
            onChange={(event) => {
              const selected = scenarios.find(
                (item) => item.value === event.target.value,
              );
              if (selected) setScenario(selected.value);
            }}
          >
            {scenarios.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!!task.pending || !running || !supported}
          >
            Run fixture
          </button>
        </div>
      </form>
      {!running && (
        <p className="scope-note">
          Start or resume the machine to run a fixture.
        </p>
      )}
      {execution && (
        <div className="execution-summary">
          <p role="status">
            Execution: <strong>{execution.state}</strong>
            {execution.exitCode !== undefined &&
              ` · exit ${execution.exitCode}`}
            {execution.errorCode && ` · ${execution.errorCode}`}
          </p>
          {execution.state === "unknown" && (
            <p className="feedback">
              The reply was lost. Check status to find the existing command. Do
              not dispatch it again.
            </p>
          )}
          {execution.state === "failed" && (
            <p className="feedback feedback-error">
              This fixture failed. Inspect its recorded error code, then select
              another scenario for a new request.
            </p>
          )}
          <div className="button-row">
            <button
              type="button"
              disabled={!!task.pending}
              onClick={() => {
                if (operationId)
                  void task.run("Check execution", () =>
                    status({ profile, operationId }),
                  );
              }}
            >
              Check execution
            </button>
            <button
              type="button"
              disabled={
                !!task.pending || !active || execution.state === "unknown"
              }
              onClick={() => {
                if (operationId)
                  void task.run("Cancel execution", () =>
                    cancel({ profile, operationId }),
                  );
              }}
            >
              Cancel execution
            </button>
          </div>
          {execution.cancellation.requested && (
            <p>
              Cancellation: {execution.cancellation.acknowledgement}. Check
              execution to observe the final state.
            </p>
          )}
        </div>
      )}
      {operationId ? (
        <LogPages
          key={operationId}
          profile={profile}
          operationId={operationId}
        />
      ) : (
        <p className="empty-output">
          No execution selected. Run a fixture or select recent history.
        </p>
      )}
      <details>
        <summary>Recent execution history</summary>
        <ul className="history-list">
          {history?.page
            .filter((row) => row.kind === "execute")
            .map((row) => (
              <li key={row.operationId}>
                <button
                  type="button"
                  disabled={!!task.pending}
                  onClick={() => setOperationId(row.operationId)}
                >
                  {row.operationId.slice(0, 8)} · {row.status}
                </button>
              </li>
            ))}
        </ul>
      </details>
      <details>
        <summary>Public API</summary>
        <pre>
          <code>
            {
              "providers.execution(createExecutionStore(ctx, components.sandbox))\n  .start({ sandbox, operationId, input });\n// useQuery(api.demo.execution, { profile, operationId })\n// observes the component record. Unknown starts are reconciled."
            }
          </code>
        </pre>
      </details>
    </section>
  );
}
function LogPages({
  profile,
  operationId,
}: {
  profile: Profile;
  operationId: string;
}) {
  const [cursors, setCursors] = useState<(number | null)[]>([null]);
  const cursor = cursors[cursors.length - 1] ?? null;
  const logs = useQuery(api.demo.logs, { profile, operationId, cursor });
  return (
    <div className="log-pages">
      <div className="panel-heading">
        <h4>Recorded output</h4>
        <span>
          Page {cursors.length}
          {logs?.truncated ? " · truncated" : ""}
        </span>
      </div>
      <textarea
        readOnly
        aria-label="Command output"
        value={
          logs?.entries.map((entry) => entry.text).join("") ||
          "No recorded output on this page."
        }
      />
      <div className="button-row">
        <button
          type="button"
          disabled={cursors.length === 1}
          onClick={() => setCursors((current) => current.slice(0, -1))}
        >
          Previous output
        </button>
        <button
          type="button"
          disabled={!logs || logs.isDone || logs.nextCursor === null}
          onClick={() => {
            if (logs?.nextCursor !== null && logs?.nextCursor !== undefined)
              setCursors((current) => [...current, logs.nextCursor]);
          }}
        >
          Next output
        </button>
      </div>
    </div>
  );
}
export function FilesPanel({
  profile,
  task,
  supported,
}: {
  profile: Profile;
  task: Task;
  supported: boolean;
}) {
  const files = useQuery(api.demo.files, { profile });
  const write = useAction(api.demo.writeFile),
    read = useAction(api.demo.readFile),
    remove = useAction(api.demo.deleteFile);
  const [path, setPath] = useState("/workspace/note.txt"),
    [text, setText] = useState("Hello from the playground.\n");
  return (
    <section className="operation-panel">
      <div className="panel-heading">
        <h3>Workspace files</h3>
        <span className="step">SYNTHETIC DISK</span>
      </div>
      <p>
        Use synthetic text only. Paths must stay inside /workspace. Reads and
        writes are bounded to 4 KiB.
      </p>
      <ul className="file-list">
        {files?.map((file) => (
          <li key={file.path}>
            <button
              type="button"
              disabled={!!task.pending}
              onClick={() => setPath(file.path)}
            >
              {file.path}
            </button>
            <span>{file.sizeBytes} B</span>
          </li>
        ))}
      </ul>
      {files?.length === 0 && <p>No files on this fixture disk.</p>}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void task.run("Write file", () =>
            write({ profile, path, text, operationId: crypto.randomUUID() }),
          );
        }}
      >
        <label htmlFor="file-path">File path</label>
        <input
          id="file-path"
          value={path}
          onChange={(event) => setPath(event.target.value)}
          required
          disabled={!!task.pending}
        />
        <label htmlFor="file-text">File contents</label>
        <textarea
          id="file-text"
          rows={4}
          value={text}
          onChange={(event) => setText(event.target.value)}
          disabled={!!task.pending}
        />
        <div className="button-row">
          <button type="submit" disabled={!!task.pending || !supported}>
            Write file
          </button>
          <button
            type="button"
            disabled={!!task.pending || !supported}
            onClick={() =>
              void task.run("Read file", async () => {
                const result = await read({ profile, path });
                setText(result.text);
              })
            }
          >
            Read file
          </button>
          <button
            type="button"
            disabled={!!task.pending || !supported}
            onClick={() =>
              void task.run("Delete file", () =>
                remove({ profile, path, operationId: crypto.randomUUID() }),
              )
            }
          >
            Delete file
          </button>
        </div>
      </form>
      <details>
        <summary>Public API</summary>
        <pre>
          <code>
            {
              "providers.files(createFileStore(ctx, components.sandbox))\n  .writeText({ sandbox, path, text, operationId });\n// authorizePath enforces the host file policy before SDK calls."
            }
          </code>
        </pre>
      </details>
    </section>
  );
}
