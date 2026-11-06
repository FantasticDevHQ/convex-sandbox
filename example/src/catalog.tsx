import { useAction } from "convex/react";
import type { RegistryRecord } from "@fantastic.dev/convex-sandbox";
import { api } from "../convex/_generated/api";
import { CatalogPanel } from "./catalog-panel";
export function ConnectedCatalog({ row }: { row: RegistryRecord }) {
  const load = useAction(api.live.catalog.load);
  return (
    <CatalogPanel
      sourceKey={row.key}
      load={() =>
        load({
          key: row.key,
          generation: row.generation,
          providerId: row.reference.providerId,
        })
      }
    />
  );
}
