// Synthetic runtime proof only. The queue/receipts below are not a production
// scheduler: production hosts must atomically persist authorization+dedupe+enqueue.
import {
  createBoatProvider,
  createBoatWebhookHandler,
  type BoatWebhookHint,
} from "@fantastic.dev/convex-sandbox/boat";
import {
  SandboxProviders,
  type LifecycleStore,
  type SandboxKey,
} from "@fantastic.dev/convex-sandbox";

export async function boatWebhookProof(
  store: LifecycleStore,
  sandbox: SandboxKey,
) {
  const key = new TextEncoder().encode(
    "synthetic-webhook-proof-signing-material",
  );
  const now = Date.now();
  const receipts = new Set<string>();
  const queue: Array<{ generation: number; providerId: string }> = [];
  let reads = 0,
    mutations = 0;
  const providers = new SandboxProviders({ authorize: async () => {} });
  providers.register(
    createBoatProvider({
      apiKey: "synthetic-webhook-provider-key",
      fetch: async (_url, init) => {
        if (init?.method !== "GET") {
          mutations++;
          throw Error("Unexpected webhook mutation");
        }
        reads++;
        return new Response(
          JSON.stringify({
            ok: true,
            sandbox: {
              id: "bx_23456789",
              state: "ready",
              desktopUrl: "https://example.test/?token=private-webhook-marker",
            },
          }),
        );
      },
    }),
  );
  const scheduledHints: BoatWebhookHint[] = [];
  const enqueueRefresh = async (
    hint: BoatWebhookHint,
    { signal }: { signal: AbortSignal },
  ) => {
    const current = await store.get(sandbox);
    if (signal.aborted) throw Error("Expired ingress");
    if (
      hint.accountId !== "proof-account" ||
      !current ||
      current.tombstone ||
      current.reference.provider !== hint.provider ||
      current.reference.providerId !== hint.providerId
    )
      return "ignored" as const;
    const receipt = JSON.stringify([
      hint.accountId,
      hint.endpointId,
      hint.deliveryId,
    ]);
    if (receipts.has(receipt)) return "duplicate" as const;
    receipts.add(receipt);
    queue.push({ generation: current.generation, providerId: hint.providerId });
    scheduledHints.push(hint);
    return "scheduled" as const;
  };
  const options = {
    accountId: "proof-account",
    endpointId: "proof-endpoint",
    signingKeys: [key],
    timestampUnit: "milliseconds" as const,
    maxAgeMs: 300000,
    maxFutureSkewMs: 30000,
    now: () => now,
    enqueueRefresh,
  };
  async function delivery(id: string, providerId = "bx_23456789") {
    const body = JSON.stringify({
      id: `evt_${id.repeat(32)}`,
      type: "sandbox.error",
      createdAt: new Date(now - (id === "b" ? 10000 : 0)).toISOString(),
      data: {
        sandbox: { id: providerId, name: "private-webhook-marker" },
        state: "error",
      },
    });
    const eventId = `evt_${id.repeat(32)}`;
    const imported = await crypto.subtle.importKey(
      "raw",
      key,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const digest = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        imported,
        new TextEncoder().encode(`${eventId}.${now}.${body}`),
      ),
    );
    const signature = [...digest]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    return new Request("https://example.test/webhooks/boat", {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/json",
        "X-Ascii-Event": "sandbox.error",
        "X-Ascii-Delivery": eventId,
        "X-Ascii-Timestamp": String(now),
        "X-Ascii-Attempt": "1",
        "X-Ascii-Signature": `v1=${signature}`,
      },
    });
  }
  const handler = createBoatWebhookHandler(options);
  const requests = [
    await delivery("a"),
    await delivery("a"),
    await delivery("b"),
    await delivery("c", "bx_abcdefgh"),
  ];
  const statuses = await Promise.all(
    requests.map(async (request) => (await handler(request)).status),
  );
  statuses.push(
    (
      await createBoatWebhookHandler({
        ...options,
        accountId: "foreign-account",
      })(await delivery("d"))
    ).status,
  );
  const queued = queue.length;
  // Simulate an expired-generation scheduled hint; the worker drops it before GET.
  queue.push({ generation: -1, providerId: "bx_23456789" });
  let staleSkipped = 0;
  for (const job of queue) {
    // Real hosts resolve tenant authority and current binding again in this action.
    const current = await store.get(sandbox);
    if (
      !current ||
      current.tombstone ||
      current.generation !== job.generation ||
      current.reference.provider !== "boat" ||
      current.reference.providerId !== job.providerId
    ) {
      staleSkipped++;
      continue;
    }
    await providers.lifecycle(store).refresh(sandbox);
  }
  const current = await store.get(sandbox);
  return {
    authenticated: statuses.every((value) => value === 204),
    deduplicated: queued === 2,
    authorized: reads === 2,
    generationFenced: staleSkipped === 1,
    authoritative: current?.observedState === "running" && mutations === 0,
    recordsSafe:
      !JSON.stringify([current, scheduledHints]).includes(
        "private-webhook-marker",
      ) && !JSON.stringify(scheduledHints).includes("state"),
  };
}
