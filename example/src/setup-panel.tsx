import { useRef, useState } from "react";

export type SetupConfiguration = {
  keyConfigured: boolean;
  missing: "BOAT_API_KEY"[];
  wallet: string | null;
};
export type SetupReadiness = SetupConfiguration & {
  state: "missing" | "checked" | "unavailable";
  accountId: string | null;
  walletTeamId: string | null;
  canStart: boolean | null;
  activeSandboxes: number | null;
  maxActiveSandboxes: number | null;
};

export function SetupPanel({
  configuration,
  check,
}: {
  configuration: SetupConfiguration | undefined;
  check: () => Promise<SetupReadiness>;
}) {
  const active = useRef(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<SetupReadiness | null>(null);
  const [failed, setFailed] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  async function checkReadiness() {
    if (active.current) return;
    active.current = true;
    setPending(true);
    setFailed(false);
    setResult(null);
    setCheckedAt(null);
    try {
      const next = await check();
      if (next.state === "unavailable") setFailed(true);
      else {
        setResult(next);
        setCheckedAt(new Date().toLocaleTimeString());
      }
    } catch {
      setFailed(true);
    } finally {
      active.current = false;
      setPending(false);
    }
  }
  if (!configuration) return <p role="status">Loading server configuration…</p>;
  const matchingResult =
    result?.wallet === configuration.wallet &&
    result?.keyConfigured === configuration.keyConfigured
      ? result
      : null;
  const current = matchingResult ?? configuration;
  const checked = matchingResult?.state === "checked" ? matchingResult : null;
  return (
    <div className="setup-panel">
      <p className="lede">
        Check server configuration before creating any resources. A check makes
        only account and limits reads.
      </p>
      <div className="workspace-facts">
        <div>
          <span>BOAT_API_KEY</span>
          <strong>{current.keyConfigured ? "Configured" : "Missing"}</strong>
          <small>Server only</small>
        </div>
        <div>
          <span>Selected wallet</span>
          <strong>{current.wallet ?? "Invalid configuration"}</strong>
          <small>Host-selected, not a browser choice</small>
        </div>
        <div>
          <span>Live run</span>
          <strong>Not approved</strong>
          <small>Setup grants no spending authority</small>
        </div>
      </div>
      <section className="setup-card">
        <span className="step">01 / SERVER CONFIGURATION</span>
        <h2>Connect your Boat account.</h2>
        {current.missing.map((name) => (
          <p className="setup-missing" key={name}>
            {name} is missing.
          </p>
        ))}
        <p>
          The provider key stays in trusted Convex environment configuration.
          Its value is never returned to this screen.
        </p>
        <p>
          Use the managed anonymous backend for this checkout. Set BOAT_API_KEY
          and optional BOAT_ORG only on that owned backend when authorized.
        </p>
      </section>
      <section className="setup-card">
        <span className="step">02 / READ-ONLY READINESS</span>
        <h2>Inspect the selected account.</h2>
        <p>
          No machine is created, started, stopped or deleted. The selected
          wallet is explicit; the check never changes the account's active
          wallet.
        </p>
        <button
          type="button"
          disabled={pending || !current.keyConfigured || !current.wallet}
          onClick={() => void checkReadiness()}
        >
          {pending ? "Checking readiness…" : "Check read-only readiness"}
        </button>
        {pending && <p role="status">Reading account identity and limits…</p>}
        {failed && (
          <p role="alert">
            Readiness could not be checked. Verify server configuration and
            account permissions, then retry. Provider errors and credentials are
            withheld.
          </p>
        )}
        {checked && (
          <div className="readiness-result" role="status">
            <p>
              {checked.canStart === true
                ? "Provider reports starts available"
                : checked.canStart === false
                  ? "Provider reports starts blocked"
                  : "Start availability was not reported"}
            </p>
            <dl className="setup-facts">
              <div>
                <dt>Account ID</dt>
                <dd>{checked.accountId ?? "Not reported"}</dd>
              </div>
              <div>
                <dt>Organization wallet ID</dt>
                <dd>{checked.walletTeamId ?? "Personal wallet"}</dd>
              </div>
              <div>
                <dt>Active / capacity</dt>
                <dd>
                  {checked.activeSandboxes ?? "Unknown"} /{" "}
                  {checked.maxActiveSandboxes ?? "Unknown"}
                </dd>
              </div>
            </dl>
            <p>
              Read at {checkedAt}. These are provider-reported facts from this
              check, not approval for a live run.
            </p>
          </div>
        )}
      </section>
      <aside className="setup-card">
        <span className="step">HOSTED CONVEX / UNVERIFIED</span>
        <h2>FantasticDev ownership is required.</h2>
        <p>
          Before hosted configuration, verify the actual FantasticDev team
          slug/ID, existing project and selected deployment from authenticated
          Convex metadata. No hosted selection has been verified here. Local
          worktrees remain isolated and anonymous.
        </p>
        <p>
          Next, review a bounded run. Checking setup does not authorize Boat
          provisioning.
        </p>
      </aside>
    </div>
  );
}
