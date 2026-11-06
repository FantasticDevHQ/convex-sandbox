import { createRoot } from "react-dom/client";
import { CatalogPanel } from "../../src/catalog-panel";
import "../../src/style.css";
let reads = 0;
const root = document.getElementById("root");
if (!root) throw Error("No root");
createRoot(root).render(
  <main className="workbench workflow-page">
    <p>
      Offline UI test. Synthetic source catalog and capability declaration; no
      Boat requests.
    </p>
    <h1>Templates and limits</h1>
    <CatalogPanel
      sourceKey="research-one"
      load={async () => {
        reads++;
        if (reads > 1 && location.search.includes("fail"))
          throw Error("Synthetic catalog failure");
        return {
          page: {
            items: [
              {
                reference: {
                  provider: "boat",
                  id: "demo-base",
                  kind: "template",
                },
                readiness: "pending",
              },
              {
                reference: {
                  provider: "boat",
                  id: "ready-base",
                  kind: "template",
                },
                readiness: "ready",
              },
            ],
            nextCursor: null,
            partial: true,
          },
          capabilities: {
            version: 1,
            supported: ["listTemplates"],
            limits: { maxFileBytes: 65536 },
            persistence: { diskOnStop: "retained", memoryOnStop: "discarded" },
          },
        };
      }}
    />
  </main>,
);
