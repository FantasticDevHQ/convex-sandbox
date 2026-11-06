import { useRef, useState } from "react";
import type {
  CachedLogPage,
  ExecutionRecord,
} from "@fantastic.dev/convex-sandbox";
export function LogsPanel({
  record,
  cache,
  sync,
}: {
  record: ExecutionRecord;
  cache: CachedLogPage | null | undefined;
  sync: () => Promise<unknown>;
}) {
  const busy = useRef(false);
  const [pending, setPending] = useState(false),
    [failed, setFailed] = useState(false);
  async function read() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setFailed(false);
    try {
      await sync();
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  const text = (stream: "stdout" | "stderr") =>
    cache?.entries
      .filter((e) => e.stream === stream)
      .map((e) => e.text)
      .join("") ?? "";
  return (
    <section className="setup-card command-output" aria-label="Command output">
      <span className="step">BOUNDED OUTPUT / RETAINED CURSOR</span>
      <h2>Command output</h2>
      <dl className="setup-facts">
        <div>
          <dt>Execution</dt>
          <dd data-testid="log-process-state">{record.state}</dd>
        </div>
        <div>
          <dt>Output</dt>
          <dd data-testid="log-bound">
            {cache?.truncated || record.outputTruncated
              ? "Truncated"
              : "Within limit"}
          </dd>
        </div>
        <div>
          <dt>Exit code</dt>
          <dd>{record.exitCode ?? "Not reported"}</dd>
        </div>
      </dl>
      {cache === undefined && <p>Loading retained output…</p>}
      {cache === null && <p>Output is unavailable for this binding.</p>}
      <h3>stdout</h3>
      <pre data-testid="log-stdout" tabIndex={0}>
        {text("stdout") || "No stdout bytes received."}
      </pre>
      <h3>stderr</h3>
      <pre data-testid="log-stderr" tabIndex={0}>
        {text("stderr") || "No stderr bytes received."}
      </pre>
      {(cache?.truncated || record.outputTruncated) && (
        <p role="status">
          Output is truncated. The shared cache retains at most 64 KiB or 32
          chunks. Native offset gaps or invalid text can also omit bytes.
        </p>
      )}
      {record.logErrorCode && (
        <p role="alert">
          Output read failed ({record.logErrorCode}). The native agent may not
          support raw offsets. Cached bytes and the original cursor remain
          retained; no command was restarted.
        </p>
      )}
      {failed && (
        <p role="alert">
          Output refresh was not confirmed. Retained bytes remain visible.
          Verify operator access and the original reviewed account before
          retrying.
        </p>
      )}
      <button
        type="button"
        onClick={() => void read()}
        disabled={
          pending ||
          !record.executionId ||
          cache == null ||
          record.outputBytes >= 65536 ||
          cache.entries.length >= 32
        }
      >
        {pending ? "Reading original output…" : "Read next output"}
      </button>
      <p>
        The shared client resumes its retained native cursor. An empty or
        drained output page does not prove process exit. Inspect command status
        separately.
      </p>
      <p>
        Each refresh reads at most one bounded native page per stream. The view
        replaces its cached snapshot, so overlapping updates do not repeat
        bytes.
      </p>
    </section>
  );
}
