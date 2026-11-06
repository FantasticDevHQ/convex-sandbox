import { Link } from "@tanstack/react-router";
import { useAction, useConvexConnectionState, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { BackendBoundary } from "./backend";
import { backendClient } from "./backend-client";
import { useTask } from "./use-task";
import { Machine } from "./playground-machine";

const profiles = ["ephemeral", "persistent", "memory"] as const;
export type Profile = (typeof profiles)[number];
export function Playground({ profile }: { profile?: string }) {
  return (
    <section className="playground">
      <div className="playground-heading">
        <div>
          <p className="eyebrow">Component workbench / interactive</p>
          <h1>
            Your sandbox <em>workbench.</em>
          </h1>
        </div>
        <span className="simulation-badge">Simulated provider</span>
      </div>
      <p className="simulation-note">No real VM or shell is running.</p>
      {backendClient ? (
        <BackendBoundary>
          <Connected profile={profile} />
        </BackendBoundary>
      ) : (
        <section className="empty-state">
          <span className="step">LOCAL SETUP</span>
          <h2>Connect a local backend</h2>
          <p>
            Run these commands from a clean, committed checkout. Open the
            frontend URL printed by the managed start command.
          </p>
          <pre>
            <code>
              {
                "pnpm install --frozen-lockfile\npnpm worktree:setup\npnpm worktree:start --frontend"
              }
            </code>
          </pre>
          <p>
            No provider keys or account login required. This route runs only
            synthetic workflows. Boat mode has separate authenticated setup.
          </p>
        </section>
      )}
    </section>
  );
}
function Connected({ profile }: { profile?: string }) {
  const info = useQuery(api.demo.info, {});
  const rows = useQuery(api.demo.list, {});
  const connection = useConvexConnectionState();
  const seed = useAction(api.demo.seed),
    reset = useAction(api.demo.reset);
  const task = useTask();
  const selected = profiles.find((value) => value === profile);
  return (
    <>
      {!connection.isWebSocketConnected && (
        <p role="status" className="feedback">
          Connecting to the local backend… Start the managed backend if it is
          stopped. Queries reconnect automatically.
        </p>
      )}
      <div className="playground-toolbar">
        <span>
          LOCAL FIXTURE{" "}
          <span className="code-muted">/ epoch {info?.epoch ?? "—"}</span>
        </span>
        <div className="button-row">
          <button
            type="button"
            disabled={!info || !!task.pending || info.initialized}
            onClick={() =>
              void task.run("Create demo machines", () => seed({}))
            }
          >
            Create demo machines
          </button>
          <button
            type="button"
            disabled={!info?.initialized || !!task.pending}
            onClick={() => void task.run("Reset demo data", () => reset({}))}
          >
            Reset demo data
          </button>
        </div>
      </div>
      <p className="scope-note">
        Reset creates a clean fixture epoch. Earlier component history remains
        in this local database.
      </p>
      {task.pending && (
        <p role="status" className="feedback">
          {task.pending}… Awaiting the host action.
        </p>
      )}
      {task.notice && (
        <div
          role={task.notice.error ? "alert" : "status"}
          className={`feedback ${task.notice.error ? "feedback-error" : ""}`}
        >
          {task.notice.text}
          <button type="button" onClick={task.dismiss}>
            Dismiss
          </button>
        </div>
      )}
      {!info || !rows ? (
        <p role="status">Loading component records…</p>
      ) : !info.initialized ? (
        <div className="empty-state">
          <h2>No demo machines yet</h2>
          <p>
            Create three synthetic machines to explore disk retention, memory
            pause and capability differences.
          </p>
        </div>
      ) : (
        <div className="sandbox-layout">
          <aside className="machine-list" aria-label="Simulated sandboxes">
            <div className="section-label">
              <h2>Machines</h2>
              <span>03 profiles</span>
            </div>
            {info.profiles.map((item) => {
              const row = rows.page.find((value) => value.key === item.profile);
              return (
                <Link
                  key={item.profile}
                  to="/playground/$profile"
                  params={{ profile: item.profile }}
                  className="machine-link"
                >
                  <span className="machine-symbol" aria-hidden="true">
                    ▧
                  </span>
                  <span>
                    <strong>{item.profile}</strong>
                    <small>{item.provider}</small>
                  </span>
                  <span className="machine-state">
                    {row?.observedState ?? "unavailable"}
                  </span>
                </Link>
              );
            })}
            <p className="scope-note">
              Only simulated adapters are installed. Resource values are fixture
              metadata.
            </p>
          </aside>
          <div className="machine-detail">
            {selected ? (
              <Machine
                key={`${info.epoch}-${selected}`}
                profile={selected}
                task={task}
                capabilities={
                  info.profiles.find((item) => item.profile === selected)
                    ?.capabilities
                }
              />
            ) : (
              <div className="empty-state">
                <h2>{profile ? "Unknown profile" : "Choose a machine"}</h2>
                <p>
                  Select one of the three simulated profiles. No live providers
                  can be selected.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
