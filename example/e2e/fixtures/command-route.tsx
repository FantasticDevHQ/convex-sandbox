import { createRoot } from "react-dom/client";
import { createRootRoute, createMemoryHistory, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { ConnectedCommands } from "../../src/commands";
import "../../src/style.css";
const rootRoute = createRootRoute();
const route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/commands",
  validateSearch: (search: Record<string, unknown>) => ({
    machine: typeof search.machine === "string" ? search.machine : undefined,
    operation: typeof search.operation === "string" ? search.operation : undefined,
  }),
  component: () => {
    const { machine, operation } = route.useSearch();
    return <main className="workbench">
      <p>Offline connected command route. Synthetic hooks refuse approval; no native calls.</p>
      <output data-testid="selected-operation">{operation ?? "none"}</output>
      <ConnectedCommands key={machine} machineKey={machine ?? "research-one"} operationId={operation} />
    </main>;
  },
});
const router = createRouter({
  routeTree: rootRoute.addChildren([route]),
  history: createMemoryHistory({ initialEntries: ["/commands?machine=research-one"] }),
});
const root = document.getElementById("root");
if (!root) throw Error("No root");
createRoot(root).render(<RouterProvider router={router} />);
