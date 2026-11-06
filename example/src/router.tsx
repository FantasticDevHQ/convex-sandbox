import { CommandsPage } from "./commands";
import { FilesPage } from "./files";
import { CreatePage } from "./create";
import { AllowancePage } from "./allowance";
import { MachinesPage, MachinePage } from "./machines";
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
  useMatches,
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
  const pathname = useMatches({
    select: (matches) => matches.at(-1)?.pathname ?? "/",
  });
  const boatMode = [
    "/setup",
    "/machines",
    "/commands",
    "/files",
    "/forks",
    "/operations",
    "/cleanup",
  ].some((path) => pathname === path || pathname.startsWith(`${path}/`));
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
              search={
                to === "/commands"
                  ? { machine: undefined, operation: undefined }
                  : to === "/files"
                    ? { machine: undefined }
                    : undefined
              }
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
          <section className="mode-controls" aria-label="Mode selection">
            <div className="mode-options">
              <Link
                to="/playground"
                className="mode-option"
                aria-label="Simulator mode"
                data-selected={!boatMode}
              >
                Simulator
              </Link>
              <Link
                to="/setup"
                className="mode-option"
                aria-label="Boat mode"
                data-selected={boatMode}
              >
                Boat
              </Link>
            </div>
            <span
              className="mode-label"
              data-mode={boatMode ? "boat" : "simulation"}
              aria-live="polite"
            >
              <span className="status-dot" />{" "}
              {boatMode
                ? "Boat · no simulated fallback"
                : "Simulator · no live provider"}
            </span>
          </section>
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
const allowanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup/run",
  component: AllowancePage,
});
const machinesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/machines",
  component: MachinesPage,
});
const createRouteEntry = createRoute({
  getParentRoute: () => rootRoute,
  path: "/machines/new",
  validateSearch: (search: Record<string, unknown>) => ({
    key: typeof search.key === "string" ? search.key : undefined,
  }),
  component: () => {
    const { key } = createRouteEntry.useSearch();
    return <CreatePage machineKey={key} />;
  },
});
const commandsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/commands",
  validateSearch: (search: Record<string, unknown>) => ({
    machine: typeof search.machine === "string" ? search.machine : undefined,
    operation:
      typeof search.operation === "string" ? search.operation : undefined,
  }),
  component: () => {
    const { machine, operation } = commandsRoute.useSearch();
    return <CommandsPage machineKey={machine} operationId={operation} />;
  },
});
const filesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/files",
  validateSearch: (search: Record<string, unknown>) => ({
    machine: typeof search.machine === "string" ? search.machine : undefined,
  }),
  component: () => <FilesPage machineKey={filesRoute.useSearch().machine} />,
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
    return <MachinePage machineKey={machineId} />;
  },
});
export const router = createRouter({
  routeTree: rootRoute.addChildren([
    overviewRoute,
    setupRoute,
    allowanceRoute,
    machinesRoute,
    createRouteEntry,
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
