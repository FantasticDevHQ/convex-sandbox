import { useAction, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { DeletePanel } from "./delete-panel";
export function ConnectedDeletion({ machineKey }: { machineKey: string }) {
  const view = useQuery(api.live.delete.status, { key: machineKey });
  const request = useAction(api.live.delete.request),
    inspect = useAction(api.live.delete.inspect);
  return (
    <DeletePanel
      view={view}
      request={(confirmation, reviewToken) =>
        request({ key: machineKey, confirmation, reviewToken })
      }
      inspect={() => inspect({ key: machineKey })}
    />
  );
}
