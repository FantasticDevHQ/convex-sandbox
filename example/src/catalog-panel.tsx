import { useRef, useState } from "react";
import type { Capability } from "@fantastic.dev/convex-sandbox";
import type { CatalogView } from "../convex/live/catalog";
const limits: Array<{ capability: Capability; label: string; reason: string }> =
  [
    {
      capability: "createTemplate",
      label: "Capture template",
      reason:
        "Mutable saved names have no immutable capture generation or job identity.",
    },
    {
      capability: "restore",
      label: "Restore in place",
      reason: "A faithful retained restore job is unavailable.",
    },
    {
      capability: "getConnection",
      label: "Desktop access",
      reason:
        "Native access cannot enforce the required expiry and bearer-lifetime contract.",
    },
    {
      capability: "getConnection",
      label: "SSH access",
      reason:
        "The shared connection contract is unsupported; no access URL or key is requested.",
    },
    {
      capability: "transferFile",
      label: "Transfer file",
      reason: "Native transfer URLs do not enforce the component byte bound.",
    },
  ];
export function CatalogPanel({
  sourceKey,
  load,
}: {
  sourceKey: string;
  load: () => Promise<CatalogView>;
}) {
  const [view, setView] = useState<CatalogView | null>(null),
    [pending, setPending] = useState(false),
    [failed, setFailed] = useState(false);
  const busy = useRef(false);
  async function refresh() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setFailed(false);
    try {
      setView(await load());
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <section
      className="setup-card source-catalog"
      aria-label="Templates and limits"
    >
      <span className="step">AUTHORIZED SOURCE / READ-ONLY CATALOG</span>
      <h2>Templates and limits</h2>
      <p>
        Native saved names for <strong>{sourceKey}</strong>. Names are mutable,
        not immutable deployment artifacts. Readiness does not authorize capture
        or provisioning.
      </p>
      <button type="button" disabled={pending} onClick={() => void refresh()}>
        {pending ? "Reading source catalog…" : "Read source catalog"}
      </button>
      {failed && (
        <p role="alert">
          Catalog refresh failed. Any previously loaded page is an older
          observation. Verify operator access and server configuration before
          retrying.
        </p>
      )}
      {view ? (
        <>
          <h3>Source catalog</h3>
          {view.page.items.length === 0 && (
            <p>No entries for this source in the bounded catalog.</p>
          )}
          <ul className="catalog-items">
            {view.page.items.map((item) => (
              <li key={item.reference.id}>
                <code>{item.reference.id}</code>
                <span data-testid="catalog-readiness">
                  {item.readiness === "pending"
                    ? "Pending · saving"
                    : item.readiness}
                </span>
                <small>Mutable native name</small>
              </li>
            ))}
          </ul>
          {view.page.partial && (
            <p role="status">
              Partial catalog: at most 50 source entries. Native pagination is
              unsupported; no next-page cursor is fabricated.
            </p>
          )}
          <p>
            Inline file bound:{" "}
            {view.capabilities.limits?.maxFileBytes ?? "Unknown"} bytes. Memory
            on stop: {view.capabilities.persistence?.memoryOnStop ?? "Unknown"}.
          </p>
        </>
      ) : (
        <p>
          Read the catalog explicitly. No native request runs just by rendering
          these details.
        </p>
      )}
      <h3>Capability limits</h3>
      <ul className="capability-limits">
        {limits.map(({ capability, label, reason }) => {
          const supported = view?.capabilities.supported.includes(capability);
          return (
            <li key={label}>
              <button
                type="button"
                disabled
                aria-describedby={`limit-${label.replaceAll(" ", "-")}`}
              >
                {label}
              </button>
              <p id={`limit-${label.replaceAll(" ", "-")}`}>
                {view
                  ? supported
                    ? "Declared by the provider; this read-only catalog offers no mutation or connection workflow."
                    : `Unsupported. ${reason}`
                  : "Unavailable until the server capability declaration is loaded. No connection or mutation is offered here."}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
