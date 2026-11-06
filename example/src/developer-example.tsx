import { useState } from "react";
import { integrationExample } from "./integration-examples";
export function DeveloperExample({ workflow }: { workflow: string }) {
  const example = integrationExample(workflow),
    [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <details className="developer-example" onToggle={() => setCopy("idle")}>
      <summary>Developer view · {example.title} example</summary>
      <section className="setup-card">
        <span className="step">PUBLIC EXPORTS / CHECKED HOST SOURCE</span>
        <h2>{example.title} consumer example</h2>
        <p>{example.description}</p>
        <p>
          This is the host module used by the working screen. Copy it with its
          linked authentication, binding and policy helpers. Run it in trusted
          Convex actions or queries; opening this view executes no provider
          operation.
        </p>
        <div className="developer-example-actions">
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(example.source);
                setCopy("copied");
              } catch {
                setCopy("failed");
              }
            }}
          >
            Copy checked source
          </button>
          <a className="text-link" href={example.href}>
            Open {example.title} workflow →
          </a>
          <a
            className="text-link"
            href={`https://github.com/FantasticDevHQ/convex-sandbox/blob/main/example/${example.sourcePath}`}
          >
            Source and relative helpers ↗
          </a>
        </div>
        <p role="status">
          {copy === "copied"
            ? "Source copied."
            : copy === "failed"
              ? "Clipboard unavailable. Select and copy the source below."
              : "Source is compiled by pnpm test:docs against public package exports."}
        </p>
        <section
          className="code-window"
          aria-label={`${example.title} checked source`}
        >
          <div className="window-bar">example/{example.sourcePath}</div>
          <pre data-testid="checked-source">
            <code>{example.source}</code>
          </pre>
        </section>
        <p className="setup-note">
          Provider credentials stay server-only. The sample gate rejects
          hardcoded credential values; environment names are configuration
          references. Compilation verifies API compatibility, not live provider
          qualification.
        </p>
      </section>
    </details>
  );
}
