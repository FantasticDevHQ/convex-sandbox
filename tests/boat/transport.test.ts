import { expect, test, vi } from "vitest";
import { createBoatProvider } from "../../src/boat/index.js";
import { createBoatTransport } from "../../src/boat/transport.js";

const apiKey = "synthetic-server-secret";
const context = () => ({
  idempotencyKey: "stable-key",
  signal: new AbortController().signal,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

test("configured account and key stay server-local while native observations are projected", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const options = {
    apiKey,
    org: "fixture-org",
    fetch: async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return json({
        ok: true,
        sandbox: {
          id: "machine/1",
          state: "ready",
          name: "private",
          error: apiKey,
        },
      });
    },
  };
  const provider = createBoatProvider(options);
  options.org = "changed-after-construction";
  expect(provider.capabilities?.supported).toEqual([
    "create",
    "describe",
    "start",
    "stop",
    "delete",
  ]);
  expect(await provider.adapter.describe("machine/1", context())).toEqual({
    providerId: "machine/1",
    state: "running",
  });
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe("https://boat.dev/api/v1/sandboxes/machine%2F1");
  expect(new Headers(calls[0].init?.headers).get("Authorization")).toBe(
    `Bearer ${apiKey}`,
  );
  expect(new Headers(calls[0].init?.headers).get("X-Boat-Org")).toBe(
    "fixture-org",
  );
  expect(calls[0].init?.redirect).toBe("error");
  expect(JSON.stringify(provider)).not.toContain(apiKey);
});

test("default account scope is explicit personal and invalid credentials fail without dispatch", async () => {
  const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
    json({ ok: true, sandbox: { id: "m", state: "archived" } }),
  );
  expect(
    await createBoatProvider({ apiKey, fetch }).adapter.describe("m"),
  ).toEqual({ providerId: "m", state: "stopped" });
  expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("X-Boat-Org")).toBe(
    "personal",
  );
  fetch.mockClear();
  for (const invalid of ["", "  ", "secret\nheader"]) {
    expect(() => createBoatProvider({ apiKey: invalid, fetch })).toThrow(
      "Invalid provider data",
    );
  }
  expect(fetch).not.toHaveBeenCalled();
});

test("pre-abort prevents dispatch and in-flight abort reaches the actual HTTP request", async () => {
  const controller = new AbortController();
  let signal: AbortSignal | null | undefined;
  const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    signal = init?.signal;
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new Error(apiKey)), {
        once: true,
      });
      controller.abort();
    });
  });
  const provider = createBoatProvider({ apiKey, fetch });
  await expect(
    provider.adapter.describe("m", { ...context(), signal: controller.signal }),
  ).rejects.toMatchObject({ data: { code: "timeout", outcome: "unknown" } });
  expect(signal?.aborted).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockClear();
  await expect(
    provider.adapter.describe("m", { ...context(), signal: controller.signal }),
  ).rejects.toMatchObject({
    data: { code: "timeout", outcome: "not_started" },
  });
  expect(fetch).not.toHaveBeenCalled();
});

test("five-second deadline settles even when the injected fetch ignores abort", async () => {
  vi.useFakeTimers();
  try {
    const provider = createBoatProvider({
      apiKey,
      fetch: async () => new Promise<Response>(() => {}),
    });
    const result = provider.adapter
      .describe("m", context())
      .catch((error) => error);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toMatchObject({
      data: { code: "timeout", outcome: "unknown", retryable: false },
    });
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

test("the deadline cancels a stalled response body as well as fetch", async () => {
  vi.useFakeTimers();
  let cancelled = false;
  try {
    const body = new ReadableStream<Uint8Array>({
      cancel: () => {
        cancelled = true;
      },
    });
    const provider = createBoatProvider({
      apiKey,
      fetch: async () => new Response(body),
    });
    const result = provider.adapter
      .describe("m", context())
      .catch((error) => error);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toMatchObject({ data: { code: "timeout" } });
    expect(cancelled).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

test.each(["lost", "http"])(
  "a %s mutating reply sends exactly one request and exposes no raw error",
  async (failure) => {
    const fetch = vi.fn(async () => {
      if (failure === "lost") throw new Error(apiKey);
      return json({ error: apiKey }, 502);
    });
    const transport = createBoatTransport({ apiKey, fetch });
    const error = await transport
      .call("write", context(), (api, init) =>
        api.createRaw({ noEnv: true, idempotencyKey: "stable-key" }, init),
      )
      .catch((error) => error);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(error.data).toMatchObject({
      code: "unknown_outcome",
      outcome: "unknown",
      retryable: false,
    });
    expect(JSON.stringify(error)).not.toContain(apiKey);
    expect(error.message).not.toContain(apiKey);
    expect(error.cause).toBeUndefined();
  },
);

test.each([
  [400, "validation"],
  [401, "authentication"],
  [403, "authorization"],
  [404, "stale_resource"],
  [402, "quota"],
  [429, "rate_limit"],
  [503, "capacity"],
  [504, "timeout"],
])("HTTP %i maps to safe %s errors", async (status, code) => {
  const provider = createBoatProvider({
    apiKey,
    fetch: async () => json({ error: apiKey }, Number(status)),
  });
  const error = await provider.adapter
    .describe("m", context())
    .catch((error) => error);
  expect(error.data.code).toBe(code);
  expect(JSON.stringify(error)).not.toContain(apiKey);
});

test.each(["constructor", "toString", "__proto__", "future-native-state"])(
  "unrecognized state %s projects to unknown",
  async (state) => {
    const provider = createBoatProvider({
      apiKey,
      fetch: async () => json({ ok: true, sandbox: { id: "m", state } }),
    });
    expect(await provider.adapter.describe("m", context())).toEqual({
      providerId: "m",
      state: "unknown",
    });
  },
);

test("oversized or malformed observations never escape projection", async () => {
  for (const body of [
    "x".repeat(1024 * 1024 + 1),
    "not JSON",
    "null",
    "{}",
    JSON.stringify({ sandbox: { id: "other", state: "ready" } }),
  ]) {
    const provider = createBoatProvider({
      apiKey,
      fetch: async () => new Response(body),
    });
    await expect(
      provider.adapter.describe("m", context()),
    ).rejects.toMatchObject({ data: { code: "validation" } });
  }
});
