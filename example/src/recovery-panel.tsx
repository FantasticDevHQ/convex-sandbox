import { useState } from "react";
import type { OperationRecord } from "@fantastic.dev/convex-sandbox";
import type { RecoveryContext } from "../convex/live/recovery";
export function RecoveryPanel({
  machineKey,
  context,
  operations,
  inspect,
}: {
  machineKey: string;
  context: RecoveryContext;
  operations: OperationRecord[];
  inspect: (op: OperationRecord) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState(false);
  const unfinished = operations.filter((op) =>
    ["pending", "running", "unknown"].includes(op.status),
  );
  return (
    <>
      <p className="lede">
        Reopen retained work for <strong>{machineKey}</strong>. Reading this
        page never repeats a create, command, fork or lifecycle request.
      </p>
      <section className="workspace-facts" aria-label="Loaded operation counts">
        <div>
          <span>Pending / running</span>
          <strong>
            {unfinished.filter((op) => op.status !== "unknown").length}
          </strong>
          <small>In loaded history</small>
        </div>
        <div>
          <span>Unknown</span>
          <strong>
            {unfinished.filter((op) => op.status === "unknown").length}
          </strong>
          <small>Unresolved outcomes stay retained</small>
        </div>
        <div>
          <span>Current binding</span>
          <strong>
            {context.row ? `Generation ${context.row.generation}` : "Unbound"}
          </strong>
          <small>
            {context.row?.reference.providerId ??
              "No confirmed native identity"}
          </small>
        </div>
      </section>
      {error && (
        <p role="alert">
          Inspection was not confirmed. The retained record remains
          authoritative; reopen it before any further action.
        </p>
      )}
      {context.provision && (
        <section className="setup-card">
          <span className="step">RETAINED CREATION</span>
          <h2>{context.provision.operationId}</h2>
          <p>
            Status: {context.provision.status}. Boat has no supported lookup for
            an interrupted creation without a confirmed native identity. Keep
            the original intent unresolved.
          </p>
          <a
            className="text-link"
            href={`/machines/new?key=${encodeURIComponent(machineKey)}`}
          >
            Open original creation →
          </a>
        </section>
      )}
      {context.admissions.length > 0 && (
        <section className="setup-card">
          <h2>Retained allowance intents</h2>
          <p>
            Admission is not native completion. An intent can survive even when
            its action returned no operation or machine ID.
          </p>
          {context.admissions.map((a) => (
            <p key={`${a.kind}-${a.operationId}`}>
              <code>{a.operationId}</code> · {a.kind} · {a.status}
            </p>
          ))}
          {context.admissionsTruncated && (
            <p>Only the latest 20 intents of each kind are shown.</p>
          )}
          {context.forkSource && (
            <a
              className="text-link"
              href={`/forks?source=${encodeURIComponent(context.forkSource)}&child=${encodeURIComponent(machineKey)}`}
            >
              Open original fork →
            </a>
          )}
        </section>
      )}
      {operations.length === 0 && (
        <section className="setup-card">
          <h2>No retained operation records loaded.</h2>
          <p>
            This does not prove a native machine is absent. Check the original
            logical key and retained allowance intent.
          </p>
        </section>
      )}
      {operations.map((op) => {
        const stale =
          !context.row ||
          context.row.tombstone ||
          op.generation !== context.row.generation ||
          op.reference.providerId !== context.row.reference.providerId;
        const terminal = ["succeeded", "failed", "cancelled"].includes(
          op.status,
        );
        const supported =
          ["start", "resumeMemory", "stop", "delete"].includes(op.kind) ||
          (op.kind === "execute" && !!op.executionId) ||
          (op.kind === "fork" && !!op.nativeImage?.providerOperationId);
        return (
          <article
            className="setup-card recovery-operation"
            key={op.operationId}
            data-testid="retained-operation"
          >
            <span className="step">
              {op.kind} / {op.status}
            </span>
            <h2>{op.operationId}</h2>
            <dl className="recovery-identities">
              <div>
                <dt>Original machine</dt>
                <dd>{op.reference.providerId}</dd>
              </div>
              <div>
                <dt>Generation / sequence</dt>
                <dd>
                  {op.generation} / {op.sequence}
                </dd>
              </div>
              <div>
                <dt>Native handle</dt>
                <dd>
                  {op.nativeLifecycle?.id ??
                    op.nativeImage?.providerOperationId ??
                    op.executionId ??
                    "No confirmed job or execution ID"}
                </dd>
              </div>
            </dl>
            {stale ? (
              <p>
                Historical binding. Inspection is disabled; an old reply cannot
                update its replacement.
              </p>
            ) : terminal ? (
              <p>Retained terminal result. No native request is needed.</p>
            ) : (
              <p>
                {supported
                  ? "Inspect once using the original identity. Reconciliation performs bounded native reads only."
                  : "No supported native lookup handle. Keep this outcome unresolved; never replay it to discover a result."}
              </p>
            )}
            <button
              type="button"
              disabled={!!busy || stale || terminal || !supported}
              onClick={async () => {
                setBusy(op.operationId);
                setError(false);
                try {
                  await inspect(op);
                } catch {
                  setError(true);
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === op.operationId
                ? "Inspecting original…"
                : "Inspect original operation"}
            </button>
            {op.kind === "execute" && (
              <a
                className="text-link"
                href={`/commands?machine=${encodeURIComponent(machineKey)}&operation=${encodeURIComponent(op.operationId)}`}
              >
                Open command and cached logs →
              </a>
            )}
          </article>
        );
      })}
      <p className="setup-note">
        History is bounded and paginated. Unknown means unresolved. Reopening or
        inspecting work grants no new spending authority and never resets an
        intent.
      </p>
    </>
  );
}
