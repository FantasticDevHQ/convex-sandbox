import { OperatorProvider } from "./operator-access";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import "./style.css";
import { ConvexProvider } from "convex/react";
import { backendClient } from "./backend-client";

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");

const app = (
  <OperatorProvider>
    <RouterProvider router={router} />
  </OperatorProvider>
);
createRoot(root).render(
  <StrictMode>
    {backendClient ? (
      <ConvexProvider client={backendClient}>{app}</ConvexProvider>
    ) : (
      app
    )}
  </StrictMode>,
);
