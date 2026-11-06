import { createServer } from "vite";
/** Never load a checkout's hosted/local configuration into the offline fixture server. */
export function createOfflineServer(root?: string) {
  return createServer({
    root,
    envDir: false,
    server: { host: "127.0.0.1", port: 0 },
  });
}
