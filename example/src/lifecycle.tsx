import { useAction, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { LifecyclePanel } from "./lifecycle-panel";
export function ConnectedLifecycle({ machineKey }: { machineKey: string }) {
  const view = useQuery(api.live.lifecycle.status, { key: machineKey });
  const prepare = useAction(api.live.lifecycle.prepareFixture),
    run = useAction(api.live.lifecycle.run),
    inspect = useAction(api.live.lifecycle.inspect);
  return (
    <LifecyclePanel
      view={view}
      request={(action, operationId) =>
        action === "prepare"
          ? prepare({ key: machineKey })
          : action === "inspect"
            ? inspect({ key: machineKey })
            : run({
                key: machineKey,
                action: action === "start" ? "start" : "stop",
                operationId: operationId ?? "",
              })
      }
    />
  );
}
