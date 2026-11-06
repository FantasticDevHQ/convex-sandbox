import { SetupPage } from "./setup";
import { OperatorAccess } from "./operator-access";
import { useState } from "react";
import brandLogo from "../../assets/brand/logo-mark.svg";
import { Playground } from "./playground";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
} from "@tanstack/react-router";

const navigation = [
  ["/", "Overview", "01"],
  ["/setup", "Setup", "02"],
  ["/machines", "Machines", "03"],
  ["/commands", "Commands", "04"],
  ["/files", "Files", "05"],
  ["/forks", "Forks", "06"],
  ["/operations", "Operations", "07"],
  ["/cleanup", "Cleanup", "08"],
  ["/integration", "Integration", "09"],
  ["/playground", "Playground", "10"],
] as const;

function Frame() {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="app-sidebar">
        <Link
          to="/"
          className="brand"
          aria-label="convex-sandbox home"
          onClick={() => setMenuOpen(false)}
        >
          <img src={brandLogo} width="32" height="32" alt="" />
          <span>
            convex-sandbox<small>EXAMPLE APP / RC</small>
          </span>
        </Link>
        <button
          type="button"
          className="menu-toggle"
          aria-label="Navigation menu"
          aria-controls="primary-navigation"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? "Close" : "Menu"} <span aria-hidden="true">☰</span>
        </button>
        <nav id="primary-navigation" aria-label="Primary" data-open={menuOpen}>
          {navigation.map(([to, label, number]) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === "/" }}
              onClick={() => {
                setMenuOpen(false);
                if (menuOpen) document.getElementById("main-content")?.focus();
              }}
            >
              <span aria-hidden="true">{number}</span>
              {label}
            </Link>
          ))}
        </nav>
        <a className="project-credit" href="https://fantastic.dev">
          A Fantastic.Dev Project ↗
        </a>
      </aside>
      <div className="app-body">
        <header className="app-header">
          <span>Component / Example app</span>
          <span className="mode-label">
            <span className="status-dot" /> Simulator · no live provider
          </span>
        </header>
        <div className="workbench">
          <main id="main-content" tabIndex={-1}>
            <Outlet />
          </main>
          <footer>
            <a href="https://github.com/FantasticDevHQ/convex-sandbox">
              View source ↗
            </a>
            <span>Public component. Trusted host actions.</span>
          </footer>
        </div>
      </div>
    </div>
  );
}

function Overview() {
  return (
    <section className="overview-page">
      <p className="eyebrow">YOUR WORKSPACE / START HERE</p>
      <h1>
        Your sandbox
        <br />
        <em>workbench.</em>
      </h1>
      <p className="lede">
        One component for machine state, commands and files. Explore with the
        simulator, then configure a trusted Boat host.
      </p>
      <section className="workspace-facts" aria-label="Workspace status">
        <div>
          <span>Current mode</span>
          <strong>Simulator</strong>
          <small>No real VM or shell</small>
        </div>
        <div>
          <span>Live provider</span>
          <strong>Boat</strong>
          <small>Not connected in this app</small>
        </div>
        <div>
          <span>Live run</span>
          <strong>Not approved</strong>
          <small>No provisioning authorized</small>
        </div>
      </section>
      <div className="overview-actions">
        <article>
          <span className="step">01 / EXPLORE</span>
          <h2>Start with a simulated workspace.</h2>
          <p>
            Inspect reactive machine state, command outcomes and files using the
            existing local simulator.
          </p>
          <Link to="/playground" className="primary-link">
            Open playground <span aria-hidden="true">↗</span>
          </Link>
        </article>
        <article>
          <span className="step">02 / CONNECT</span>
          <h2>Prepare your trusted host.</h2>
          <p>
            Live workflows require verified operator access and server
            configuration. Setup never implies approval to create a machine.
          </p>
          <Link to="/setup" className="text-link">
            Review setup →
          </Link>
        </article>
      </div>
      <section className="recent-operations">
        <span className="step">ACTIVITY</span>
        <h2>Recent operations</h2>
        <p>
          No live operation history is connected. Open the playground to inspect
          simulator activity.
        </p>
        <Link to="/operations" className="text-link">
          View operations →
        </Link>
      </section>
    </section>
  );
}

const workflowDescriptions = {
  Setup:
    "Verified operator access and server configuration checks will appear here. No live configuration is checked by this page.",
  Machines:
    "Owned Boat machines will appear here after trusted host setup. No live machine inventory is connected.",
  Commands:
    "Detached commands and bounded logs will appear here after an owned machine is connected.",
  Files:
    "Manage bounded files in an owned home directory after trusted host setup.",
  Forks:
    "Fork a stopped source and verify retained home files after an owned machine is connected.",
  Operations:
    "Durable live operation outcomes and recovery will appear here after trusted host setup.",
  Cleanup:
    "Exact-owned cleanup will appear here after trusted host setup. This page cannot delete resources.",
};
function WorkflowPage({ name }: { name: keyof typeof workflowDescriptions }) {
  return (
    <section className="workflow-page">
      <p className="eyebrow">WORKSPACE / {name}</p>
      <h1>{name}</h1>
      <OperatorAccess>
        <div className="empty-state">
          <span className="step">LIVE WORKFLOW NOT CONNECTED</span>
          <h2>
            {name === "Setup"
              ? "Prepare the example"
              : `No live ${name.toLowerCase()} connected`}
          </h2>
          <p>{workflowDescriptions[name]}</p>
          <p>
            Use the credential-free simulator for the workflows available today.
          </p>
          <Link to="/playground" className="primary-link">
            Open playground ↗
          </Link>
          <Link to="/integration" className="text-link">
            Read integration setup →
          </Link>
        </div>
      </OperatorAccess>
    </section>
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
const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup",
  component: SetupPage,
});
const machinesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/machines",
  component: () => <WorkflowPage name="Machines" />,
});
const commandsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/commands",
  component: () => <WorkflowPage name="Commands" />,
});
const filesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/files",
  component: () => <WorkflowPage name="Files" />,
});
const forksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/forks",
  component: () => <WorkflowPage name="Forks" />,
});
const operationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/operations",
  component: () => <WorkflowPage name="Operations" />,
});
const cleanupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/cleanup",
  component: () => <WorkflowPage name="Cleanup" />,
});
const machineDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/machines/$machineId",
  component: () => {
    const { machineId } = machineDetailRoute.useParams();
    return (
      <section className="workflow-page">
        <p className="eyebrow">WORKSPACE / MACHINES</p>
        <h1>Machine details</h1>
        <code>{machineId}</code>
        <OperatorAccess>
          <div className="empty-state">
            <h2>Machine not connected</h2>
            <p>
              This URL does not establish ownership or load a live resource.
              Connect a trusted host to inspect an owned machine.
            </p>
            <Link to="/machines" className="text-link">
              ← Back to machines
            </Link>
          </div>
        </OperatorAccess>
      </section>
    );
  },
});
export const router = createRouter({
  routeTree: rootRoute.addChildren([
    overviewRoute,
    setupRoute,
    machinesRoute,
    commandsRoute,
    filesRoute,
    forksRoute,
    operationsRoute,
    cleanupRoute,
    machineDetailRoute,
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
