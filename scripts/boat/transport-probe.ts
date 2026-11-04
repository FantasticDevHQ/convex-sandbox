import { createBoatProvider } from "@fantastic.dev/convex-sandbox/boat";

/** Actual public entry in the anonymous runtime, using only synthetic fetch. */
export async function probeBoatTransport() {
  const apiKey = "synthetic-transport-probe";
  let accountScoped = false;
  const provider = createBoatProvider({
    apiKey,
    org: "fixture-wallet",
    fetch: async (_url, init) => {
      const headers = new Headers(init?.headers);
      accountScoped =
        headers.get("X-Boat-Org") === "fixture-wallet" &&
        headers.get("Authorization") === `Bearer ${apiKey}`;
      return new Response(
        JSON.stringify({
          ok: true,
          sandbox: { id: "m", state: "ready", error: apiKey },
        }),
      );
    },
  });
  const observation = await provider.adapter.describe("m");
  const controller = new AbortController();
  let aborted = false;
  const waiting = createBoatProvider({
    apiKey,
    fetch: async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new Error(apiKey));
          },
          { once: true },
        );
        controller.abort();
      }),
  });
  const error = await waiting.adapter
    .describe("m", { idempotencyKey: "probe", signal: controller.signal })
    .catch((error) => error);
  return {
    projection:
      JSON.stringify(observation) ===
      JSON.stringify({ providerId: "m", state: "running" }),
    accountScoped,
    aborted: aborted && error.data?.code === "timeout",
    noRawErrors:
      !JSON.stringify(error).includes(apiKey) &&
      !error.message.includes(apiKey),
  };
}
