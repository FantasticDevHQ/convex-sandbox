import { useAction, useQuery } from "convex/react";
import type { ExecutionRecord } from "@fantastic.dev/convex-sandbox";
import { api } from "../convex/_generated/api";
import { LogsPanel } from "./logs-panel";
export function ConnectedLogs({ record }: { record: ExecutionRecord }) {
  const handle = { key: record.key, operationId: record.operationId };
  const cache = useQuery(api.live.logs.cached, handle);
  const sync = useAction(api.live.logs.sync);
  return <LogsPanel record={record} cache={cache} sync={() => sync(handle)} />;
}
