import { useEffect, useRef, useState } from "react";
import type { CreationView } from "../convex/live/create";
import { validMachineKey } from "./machine-key";
export function CreatePanel({
  selectedKey,
  view,
  request,
}: {
  selectedKey?: string;
  view: CreationView | undefined;
  request: (key: string) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState(selectedKey ?? "");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [now, setNow] = useState(Date.now());
  const busy = useRef(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const provision = view?.provision;
  const held = view?.reservationHeld ?? false;
  const expiredClaim =
    provision?.status === "running" && now >= provision.leaseUntil;
  const interrupted =
    held &&
    !provision &&
    view?.reservationAt !== null &&
    now >= (view?.reservationAt ?? now) + 30_000;
  const unknown =
    view?.reservationUnknown ||
    provision?.status === "unknown" ||
    expiredClaim ||
    interrupted;
  const ready = Boolean(
    view?.registry?.observedState === "running" && !unknown,
  );
  const phase = unknown
    ? "Unknown outcome"
    : ready
      ? "Ready"
      : provision?.status === "failed"
        ? "Creation failed"
        : held || provision || pending
          ? "Pending readiness"
          : "Not requested";
  async function submit() {
    if (busy.current || held || provision || view?.registry || !draft.trim())
      return;
    if (!validMachineKey(draft.trim())) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    busy.current = true;
    setPending(true);
    setFailed(false);
    try {
      await request(draft.trim());
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <div className="creation-panel">
      <p className="lede">
        Create one approved Small machine through a durable component claim.
        Repeated requests keep the same logical key and operation.
      </p>
      <section className="setup-card">
        <span className="step">01 / MACHINE SETTINGS</span>
        <h2>A private test machine.</h2>
        <label className="machine-key-field">
          Logical machine key
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={pending || held || Boolean(provision || view?.registry)}
            maxLength={80}
            placeholder="research-one"
            pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}"
          />
        </label>
        {invalid && (
          <p role="alert">
            Use a key of 1–80 letters, digits, dots, underscores or hyphens,
            beginning with a letter or digit. The key new is reserved.
          </p>
        )}
        <p>Size: Small · Inherited guest secrets: Off · Visibility: Private</p>
        <p>
          The server verifies the approved account and atomically reserves run
          allowance. Missing or expired approval refuses creation.
        </p>
        {!held && !provision && !view?.registry && (
          <button
            type="button"
            onClick={() => void submit()}
            disabled={pending || !draft.trim() || Boolean(selectedKey && !view)}
          >
            {pending
              ? "Submitting original operation…"
              : "Create approved machine"}
          </button>
        )}
      </section>
      <section className="setup-card" aria-live="polite">
        <span className="step">02 / COMPONENT PROGRESS</span>
        <h2 data-testid="creation-phase">{phase}</h2>
        {selectedKey && (
          <p>
            Logical key: <code>{selectedKey}</code>
          </p>
        )}
        <p>
          Operation:{" "}
          <code>
            {view?.operationId ??
              (selectedKey
                ? `create-${selectedKey}`
                : "Assigned from your logical key")}
          </code>
        </p>
        <p>
          Creation slot: {held ? "Reserved; remains counted" : "Not reserved"}
        </p>
        {phase === "Pending readiness" && (
          <p>
            Acceptance is not readiness. Inspect the owned binding and refresh
            its observation to confirm readiness.
          </p>
        )}
        {ready && (
          <p>An independent registry observation confirms running state.</p>
        )}
        {unknown && (
          <p role="alert">
            Keep this original operation. Its outcome is unknown and its
            reservation remains counted. Do not create a replacement or guess a
            native ID; inspect exact-owned recovery records.
          </p>
        )}
        {failed && (
          <p role="alert">
            The request did not return a confirmed result. Keep this logical key
            and inspect its persisted operation before any further action.
          </p>
        )}
      </section>
      <aside className="setup-card">
        <h2>Keep the run bounded.</h2>
        <p>
          This action can incur charges. Approval and TTL do not guarantee a
          provider billing cap or shutdown. Cleanup failure and stopped or
          unknown resources may cause further charges.
        </p>
      </aside>
    </div>
  );
}
