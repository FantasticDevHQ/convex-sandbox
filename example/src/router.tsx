import { Playground } from "./playground";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
} from "@tanstack/react-router";

function Frame() {
  return (
    <div className="workbench">
      <header className="topbar">
        <Link to="/" className="brand" aria-label="convex-sandbox home">
          <span className="brand-mark" aria-hidden="true">
            ⌘
          </span>
          convex-sandbox<span className="version">0.0</span>
        </Link>
        <nav aria-label="Primary">
          <Link to="/" activeOptions={{ exact: true }}>
            Overview
          </Link>
          <Link to="/playground">Playground</Link>
          <Link to="/integration">Integration</Link>
        </nav>
        <a
          className="repository"
          href="https://github.com/FantasticDevHQ/convex-sandbox"
        >
          GitHub <span aria-hidden="true">↗</span>
        </a>
      </header>
      <main>
        <Outlet />
      </main>
      <footer>
        <span>Built with Convex · A Fantastic.Dev project</span>
        <span>Experimental baseline / 001</span>
      </footer>
    </div>
  );
}

function Overview() {
  return (
    <>
      <section className="intro">
        <div className="intro-copy">
          <p className="eyebrow">
            <span className="status-dot" /> Component workbench
          </p>
          <h1>
            One interface.
            <br />
            <em>Any sandbox.</em>
          </h1>
          <p className="lede">
            A common layer for cloud computers.
            <br />
            Keep the provider behind the boundary.
          </p>
          <Link to="/integration" className="primary-link">
            Explore the integration <span aria-hidden="true">↗</span>
          </Link>
          <p className="scope-note">Simulation · no live provider</p>
        </div>
        <section className="code-window" aria-label="Adapter boundary example">
          <div className="window-bar">
            <span>host / trusted action</span>
            <span className="window-dots" aria-hidden="true">
              ● ● ●
            </span>
          </div>
          <pre>
            <code>
              <span className="code-muted">
                {"// Adapters stay in the host action."}
              </span>
              {"\n"}
              <span className="code-purple">import</span>{" "}
              {"{ SandboxBoundary }"} <span className="code-purple">from</span>
              {"\n"}{" "}
              <span className="code-green">
                "@fantastic.dev/convex-sandbox"
              </span>
              ;{"\n\n"}
              <span className="code-purple">const</span> sandbox ={" "}
              <span className="code-purple">new</span> SandboxBoundary({"{"}
              {"\n"} simulated: adapter,{"\n"}
              {"}"});{"\n\n"}
              <span className="code-purple">await</span>{" "}
              sandbox.observe(identity,{"\n"} observation =&gt;
              record(observation){"\n"});
            </code>
          </pre>
          <div className="window-footer">
            <span className="small-dot" /> Only serializable observations cross
            the boundary.
          </div>
        </section>
      </section>
      <section className="flow-section" aria-labelledby="flow-title">
        <div className="section-label">
          <h2 id="flow-title">A small boundary. A clear responsibility.</h2>
          <span>01 — 03</span>
        </div>
        <div className="flow-grid">
          <article>
            <span className="step">01 / EXECUTE</span>
            <h3>Host action</h3>
            <p>
              Your adapter calls the provider API. Credentials and SDK objects
              stay server-side.
            </p>
          </article>
          <article>
            <span className="step">02 / VALIDATE</span>
            <h3>Typed observation</h3>
            <p>
              Project the provider response into explicit fields before
              recording it.
            </p>
          </article>
          <article>
            <span className="step">03 / OBSERVE</span>
            <h3>Convex state</h3>
            <p>
              Validated mutations write component state. Queries expose the
              recorded result.
            </p>
          </article>
        </div>
      </section>
      <aside className="baseline-note">
        <span className="note-label">IN THIS STARTER</span>
        <p>
          Explore component state, command outcomes and files in the local
          simulated playground. Live provider adapters have separate
          integrations.
        </p>
      </aside>
    </>
  );
}

function Integration() {
  return (
    <section className="integration">
      <p className="eyebrow">Integration / start here</p>
      <h1>
        Mount the
        <br />
        <em>component.</em>
      </h1>
      <p className="lede">
        The example consumes the workspace package through its public exports.
      </p>
      <div className="integration-grid">
        <div>
          <span className="step">01 / CONFIGURE</span>
          <h2>Connect the component.</h2>
          <p>
            Mount the package in your host’s Convex configuration. The
            experimental adapter runs inside an internal host action.
          </p>
          <Link to="/" className="text-link">
            ← Back to overview
          </Link>
        </div>
        <div className="code-window">
          <div className="window-bar">example/convex/convex.config.ts</div>
          <pre>
            <code>
              {
                'import sandbox from\n  "@fantastic.dev/convex-sandbox/convex.config.js";\nimport { defineApp } from "convex/server";\n\nconst app = defineApp();\napp.use(sandbox);\nexport default app;'
              }
            </code>
          </pre>
        </div>
      </div>
      <div className="setup-note">
        <h2>Run the starter locally.</h2>
        <pre>
          <code>pnpm install --frozen-lockfile{"\n"}pnpm dev:frontend</code>
        </pre>
        <p>
          The frontend starts without credentials. For the interactive
          playground, run pnpm worktree:setup, then pnpm worktree:start
          --frontend from a committed checkout. This provisions an anonymous
          local backend.
        </p>
      </div>
    </section>
  );
}

const rootRoute = createRootRoute({
  component: Frame,
  notFoundComponent: () => (
    <section className="integration">
      <h1>Page not found.</h1>
      <Link to="/">Return to overview</Link>
    </section>
  ),
});
const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Overview,
});
const playgroundRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/playground",
  component: () => <Playground />,
});
const detailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/playground/$profile",
  component: () => {
    const { profile } = detailRoute.useParams();
    return <Playground profile={profile} />;
  },
});
const integrationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/integration",
  component: Integration,
});
export const router = createRouter({
  routeTree: rootRoute.addChildren([
    overviewRoute,
    integrationRoute,
    playgroundRoute,
    detailRoute,
  ]),
});
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
