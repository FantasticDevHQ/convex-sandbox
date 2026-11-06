import { createRoot } from "react-dom/client";
import {
  createRootRoute,
  createMemoryHistory,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { ConnectedCreate } from "../../src/create";
import "../../src/style.css";
const rootRoute = createRootRoute();
const route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/machines/new",
  validateSearch: (search: Record<string, unknown>) => ({
    key: typeof search.key === "string" ? search.key : undefined,
  }),
  component: () => {
    const { key } = route.useSearch();
    return (
      <main className="workbench">
        <p>
          Offline connected-route test. Synthetic hooks refuse approval; no
          provider calls.
        </p>
        <output data-testid="selected-key">{key ?? "none"}</output>
        <ConnectedCreate machineKey={key} />
      </main>
    );
  },
});
const router = createRouter({
  routeTree: rootRoute.addChildren([route]),
  history: createMemoryHistory({ initialEntries: ["/machines/new"] }),
});
const root = document.getElementById("root");
if (!root) throw Error("No root");
createRoot(root).render(<RouterProvider router={router} />);
