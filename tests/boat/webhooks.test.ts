import { createHmac } from "node:crypto";
import { expect, test, vi } from "vitest";
import { createBoatWebhookHandler } from "@fantastic.dev/convex-sandbox/boat";

const now = 1793923200000;
const key = new TextEncoder().encode("synthetic-webhook-signing-key-12345");
const oldKey = new TextEncoder().encode("synthetic-previous-signing-key-1234");
const delivery = `evt_${"a".repeat(32)}`;
const event = {
  id: delivery,
  type: "sandbox.hydrated",
  createdAt: new Date(now).toISOString(),
  data: {
    sandbox: { id: "bx_23456789", name: "private-name" },
    state: "error",
    secret: "private-payload",
  },
};
function request(
  body = JSON.stringify(event),
  changes: Record<string, string> = {},
  signingKey = key,
) {
  const timestamp = String(now / 1000);
  const signature = createHmac("sha256", signingKey)
    .update(`${delivery}.${timestamp}.`)
    .update(body)
    .digest("hex");
  return new Request("https://example.test/boat", {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/json",
      "X-Ascii-Delivery": delivery,
      "X-Ascii-Event": event.type,
      "X-Ascii-Timestamp": timestamp,
      "X-Ascii-Attempt": "1",
      "X-Ascii-Signature": `v1=${signature}`,
      ...changes,
    },
  });
}
function fixture(overrides = {}) {
  const enqueue = vi.fn(
    async (_hint: unknown, _context: { signal: AbortSignal }) =>
      "scheduled" as const,
  );
  const handler = createBoatWebhookHandler({
    accountId: "account-a",
    endpointId: "endpoint-a",
    signingKeys: [key, oldKey],
    timestampUnit: "seconds",
    maxAgeMs: 300000,
    maxFutureSkewMs: 30000,
    now: () => now,
    enqueueRefresh: enqueue,
    ...overrides,
  });
  return { handler, enqueue };
}

test("verifies the exact bytes and projects only an account-scoped refresh hint", async () => {
  const f = fixture();
  expect((await f.handler(request())).status).toBe(204);
  expect(f.enqueue).toHaveBeenCalledOnce();
  expect(f.enqueue.mock.calls[0][0]).toEqual({
    accountId: "account-a",
    endpointId: "endpoint-a",
    deliveryId: delivery,
    provider: "boat",
    providerId: "bx_23456789",
    event: event.type,
  });
  expect(f.enqueue.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  expect(JSON.stringify(f.enqueue.mock.calls)).not.toMatch(
    /private-|signing-key|state|createdAt/,
  );
});

test.each([
  [
    "changed bytes",
    () =>
      request(`${JSON.stringify(event)} `, {
        "X-Ascii-Signature": request().headers.get("X-Ascii-Signature") ?? "",
      }),
  ],
  [
    "bad signature",
    () => request(undefined, { "X-Ascii-Signature": `v1=${"0".repeat(64)}` }),
  ],
  [
    "duplicate header",
    () => request(undefined, { "X-Ascii-Delivery": `${delivery},${delivery}` }),
  ],
  [
    "timestamp syntax",
    () => request(undefined, { "X-Ascii-Timestamp": "1e12" }),
  ],
  ["attempt", () => request(undefined, { "X-Ascii-Attempt": "9" })],
  [
    "unknown event",
    () => request(undefined, { "X-Ascii-Event": "sandbox.future" }),
  ],
  [
    "body id",
    () => request(JSON.stringify({ ...event, id: `evt_${"b".repeat(32)}` })),
  ],
  [
    "body type",
    () => request(JSON.stringify({ ...event, type: "sandbox.ready" })),
  ],
  [
    "sandbox id",
    () =>
      request(
        JSON.stringify({
          ...event,
          data: { sandbox: { id: "https://foreign.test", name: "x" } },
        }),
      ),
  ],
  ["bad JSON", () => request("not json")],
])("rejects %s without host dispatch", async (_name, build) => {
  const f = fixture();
  expect((await f.handler(build())).status).toBeGreaterThanOrEqual(400);
  expect(f.enqueue).not.toHaveBeenCalled();
});

test.each([now + 300001, now - 30001])(
  "rejects stale/future signed timestamp at host time %s",
  async (hostNow) => {
    const f = fixture({ now: () => hostNow });
    expect((await f.handler(request())).status).toBe(401);
    expect(f.enqueue).not.toHaveBeenCalled();
  },
);

test("accepts the previous rotation key and refuses it after retirement", async () => {
  expect((await fixture().handler(request(undefined, {}, oldKey))).status).toBe(
    204,
  );
  const f = fixture({ signingKeys: [key] });
  expect((await f.handler(request(undefined, {}, oldKey))).status).toBe(401);
  expect(f.enqueue).not.toHaveBeenCalled();
});

test("requires explicit timestamp units and host freshness bounds", () => {
  expect(() => fixture({ timestampUnit: undefined })).toThrow();
  expect(() => fixture({ maxAgeMs: Infinity })).toThrow();
  expect(() => fixture({ signingKeys: [] })).toThrow();
});

test("bounds raw body bytes and refuses unsupported content types", async () => {
  const f = fixture();
  expect((await f.handler(request(" ".repeat(65537)))).status).toBe(413);
  expect(
    (await f.handler(request(undefined, { "Content-Type": "text/plain" })))
      .status,
  ).toBe(415);
  expect(f.enqueue).not.toHaveBeenCalled();
});

test("returns fixed retryable errors without leaking host exceptions", async () => {
  const f = fixture({
    enqueueRefresh: async () => {
      throw Error("private-signing-key");
    },
  });
  const response = await f.handler(request());
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private");
});

test("bounds host scheduling and signals abort without dispatching another callback", async () => {
  try {
    let signal: AbortSignal | undefined;
    const enqueue = vi.fn(async (_hint, context) => {
      signal = context.signal;
      return new Promise<"scheduled">(() => {});
    });
    const f = fixture({ enqueueRefresh: enqueue });
    const result = f.handler(request());
    expect((await result).status).toBe(503);
    expect(signal?.aborted).toBe(true);
    expect(enqueue.mock.calls.length).toBeLessThanOrEqual(1);
  } finally {
    vi.restoreAllMocks();
  }
});

test("does not return a Response thrown by host code", async () => {
  const f = fixture({
    enqueueRefresh: async () => {
      throw new Response("private-host-token", { status: 418 });
    },
  });
  const response = await f.handler(request());
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private-host-token");
});

test("host routing deduplicates, rejects foreign/unbound hints and refreshes with current registry fences", async () => {
  const { convexTest } = await import("convex-test");
  const { defineSchema } = await import("convex/server");
  const { register, createTestStores } =
    await import("@fantastic.dev/convex-sandbox/testing");
  const { boatWebhookProof } =
    await import("../../example/fixtures/boatWebhook.js");
  const t = convexTest(defineSchema({}), {
    "./_generated/server.js": () =>
      import("../../example/convex/_generated/server.js"),
  });
  const c = register(t);
  const sandbox = { scope: "webhook-test", key: "machine" };
  await t.mutation(c.registry.ensure, {
    sandbox,
    reference: { provider: "boat", providerId: "bx_23456789" },
  });
  expect(
    await boatWebhookProof(
      createTestStores(t, c, () => true).lifecycle,
      sandbox,
    ),
  ).toEqual({
    authenticated: true,
    deduplicated: true,
    authorized: true,
    generationFenced: true,
    authoritative: true,
    recordsSafe: true,
  });
});

test("bounds a stalled request body and cancels its reader", async () => {
  vi.useFakeTimers();
  try {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const init = {
      method: "POST",
      headers: request().headers,
      body,
      duplex: "half",
    };
    const f = fixture();
    const result = f.handler(new Request("https://example.test/boat", init));
    await vi.advanceTimersByTimeAsync(2000);
    expect((await result).status).toBe(503);
    expect(cancelled).toBe(true);
    expect(f.enqueue).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

test("aborted incoming requests never dispatch", async () => {
  const controller = new AbortController();
  controller.abort();
  const f = fixture();
  const aborted = new Request(request(), { signal: controller.signal });
  expect((await f.handler(aborted)).status).toBe(503);
  expect(f.enqueue).not.toHaveBeenCalled();
});
