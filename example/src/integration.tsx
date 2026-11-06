import {
  integrationExample,
  integrationExamples,
} from "./integration-examples";
import { DeveloperExample } from "./developer-example";
export function IntegrationPage({ workflow }: { workflow?: string }) {
  const selected = integrationExample(workflow ?? "files");
  return (
    <section className="integration">
      <p className="eyebrow">INTEGRATION / CHECKED CONSUMER SOURCE</p>
      <h1>
        Build on the
        <br />
        <em>working flows.</em>
      </h1>
      <p className="lede">
        Inspect the exact host source behind each workflow. Public exports,
        shared clients and trusted operator boundaries stay together.
      </p>
      <nav className="integration-workflows" aria-label="Example workflow">
        {integrationExamples.map((example) => (
          <a
            key={example.id}
            href={`/integration?workflow=${example.id}`}
            aria-current={selected.id === example.id ? "page" : undefined}
          >
            {example.title}
          </a>
        ))}
      </nav>
      <section className="workspace-facts">
        <div>
          <span>Workflow</span>
          <strong>{selected.title}</strong>
          <small>Linked to its mounted screen</small>
        </div>
        <div>
          <span>Imports</span>
          <strong>Public package</strong>
          <small>Compiled in documentation checks</small>
        </div>
        <div>
          <span>Credentials</span>
          <strong>Server only</strong>
          <small>No credential values displayed</small>
        </div>
      </section>
      <DeveloperExample key={selected.id} workflow={selected.id} />
      <section className="setup-note">
        <h2>Prepare the host.</h2>
        <p>
          Local development uses the repository's isolated anonymous backend
          commands. Hosted configuration must verify the actual FantasticDev
          team slug/ID, existing project and selected deployment. No hosted
          selection or production deployment is authorized by these samples.
        </p>
        <a
          href="https://github.com/FantasticDevHQ/convex-sandbox/blob/main/example/README.md"
          className="text-link"
        >
          Read example setup and workflow boundaries ↗
        </a>
        <p>
          Samples use this app's generated component bindings and relative
          helpers. Adapt authentication, scoped authorization and finite
          operator approval before exposing a wrapper in your own host. Boat
          credentials never belong in Vite environment variables.
        </p>
      </section>
    </section>
  );
}
