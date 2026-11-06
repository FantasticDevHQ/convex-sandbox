import { useRef, useState } from "react";
import type {
  CommandInput,
  ExecutionRecord,
} from "@fantastic.dev/convex-sandbox";
export function CommandsPanel({
  machineKey,
  operationId,
  record,
  start,
  inspect,
}: {
  machineKey: string;
  operationId?: string;
  record: ExecutionRecord | null | undefined;
  start: (input: CommandInput, id: string) => Promise<unknown>;
  inspect: () => Promise<unknown>;
}) {
  const [mode, setMode] = useState<"argv" | "shell">("argv"),
    [executable, setExecutable] = useState("/usr/bin/printf"),
    [args, setArgs] = useState("%s\\n\nhello sandbox"),
    [shell, setShell] = useState('printf "hello sandbox\\n"'),
    [cwd, setCwd] = useState("");
  const [pending, setPending] = useState(false),
    [failed, setFailed] = useState<string | null>(null);
  const busy = useRef(false);
  async function run() {
    if (busy.current || operationId) return;
    const id = `command-${crypto.randomUUID()}`;
    busy.current = true;
    setPending(true);
    setFailed(null);
    const input: CommandInput =
      mode === "argv"
        ? {
            kind: "argv",
            executable,
            args: args === "" ? [] : args.split("\n"),
          }
        : { kind: "shell", command: shell };
    if (cwd) input.cwd = cwd;
    try {
      await start(input, id);
    } catch {
      setFailed(id);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function refresh() {
    if (busy.current || !operationId) return;
    busy.current = true;
    setPending(true);
    setFailed(null);
    try {
      await inspect();
    } catch {
      setFailed(operationId);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <div className="commands-panel">
      <p className="lede">
        Detached work on <strong>{machineKey}</strong>. Its operation and native
        history identity survive reload; an unknown reply never authorizes
        another start.
      </p>
      {!operationId ? (
        <section className="setup-card">
          <span className="step">01 / COMMAND INPUT</span>
          <h2>Run within your approved fixture.</h2>
          <label className="command-field">
            Input mode
            <select
              value={mode}
              disabled={pending}
              onChange={(e) => setMode(e.target.value as "argv" | "shell")}
            >
              <option value="argv">Literal arguments</option>
              <option value="shell">Shell command</option>
            </select>
          </label>
          {mode === "argv" ? (
            <>
              <label className="command-field">
                Executable
                <input
                  value={executable}
                  disabled={pending}
                  onChange={(e) => setExecutable(e.target.value)}
                  maxLength={256}
                />
              </label>
              <label className="command-field">
                Arguments, one per line
                <textarea
                  value={args}
                  disabled={pending}
                  onChange={(e) => setArgs(e.target.value)}
                  rows={4}
                />
              </label>
              <p>
                Each line is one literal argument; shell quoting is not needed.
              </p>
            </>
          ) : (
            <label className="command-field">
              Shell command
              <textarea
                value={shell}
                disabled={pending}
                onChange={(e) => setShell(e.target.value)}
                rows={4}
                maxLength={4096}
              />
            </label>
          )}
          <label className="command-field">
            Relative working directory (optional)
            <input
              placeholder="Defaults to /home/user"
              value={cwd}
              disabled={pending}
              onChange={(e) => setCwd(e.target.value)}
              maxLength={256}
            />
          </label>
          <p>
            Commands can change guest files. New execution requires an active
            approved run. Per-command environment and runtime timeout are
            unsupported.
          </p>
          <button
            type="button"
            disabled={
              pending ||
              (mode === "argv" && !executable) ||
              (mode === "shell" && !shell)
            }
            onClick={() => void run()}
          >
            {pending ? "Submitting original command…" : "Run detached command"}
          </button>
        </section>
      ) : (
        <section className="setup-card">
          <span className="step">RETAINED EXECUTION / ORIGINAL IDENTITY</span>
          <h2 data-testid="execution-state">
            {record?.state ??
              (record === undefined
                ? "Loading execution…"
                : "No retained record yet")}
          </h2>
          <dl className="setup-facts">
            <div>
              <dt>Operation</dt>
              <dd data-testid="command-operation">{operationId}</dd>
            </div>
            <div>
              <dt>Native history ID</dt>
              <dd data-testid="execution-identity">
                {record?.executionId ?? "Not known"}
              </dd>
            </div>
            <div>
              <dt>Exit code</dt>
              <dd data-testid="execution-exit-code">
                {record?.exitCode ?? "Not reported"}
              </dd>
            </div>
            <div>
              <dt>Cancellation</dt>
              <dd>Unsupported</dd>
            </div>
          </dl>
          {record?.state === "unknown" && (
            <p role="alert">
              The original command outcome is unknown. Keep this identity.
              Status inspection does not restart it, and a process ID is not a
              safe recovery handle.
            </p>
          )}
          {record === null && (
            <p>
              No retained record is available for this operation yet. Keep its
              original identity and inspect before considering new work.
            </p>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() => void refresh()}
          >
            {pending
              ? "Inspecting original execution…"
              : "Inspect command status"}
          </button>
          <p>
            Only native command history confirms exit. No shell-based or
            PID-based cancellation is offered.
          </p>
        </section>
      )}
      {failed && (
        <p role="alert">
          Request for <code>{failed}</code> was not confirmed. Keep that
          original operation and inspect its retained state; verify operator
          access and run approval before further work.
        </p>
      )}
    </div>
  );
}
