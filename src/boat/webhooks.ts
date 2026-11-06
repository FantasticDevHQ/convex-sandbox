const events = new Set([
  "sandbox.ready",
  "sandbox.error",
  "sandbox.archived",
  "sandbox.hydrated",
  "sandbox.degraded",
  "sandbox.recovered",
]);
const encoder = new TextEncoder();
const bodyLimit = 65536;
const budgetMs = 2000;

/** No provider state, credentials, payload text or caller-selected tenant identity. */
export interface BoatWebhookHint {
  accountId: string;
  endpointId: string;
  deliveryId: string;
  provider: "boat";
  providerId: string;
  event: string;
}
export interface BoatWebhookOptions {
  /** Bind this endpoint/key ring to a trusted native account, never a body field. */
  accountId: string;
  /** Stable host endpoint identity. Retain across key rotation for deduplication. */
  endpointId: string;
  /** Exact raw HMAC key bytes, active then optionally previous. No implicit decoding. */
  signingKeys: readonly Uint8Array[];
  /** Required: native timestamp units/retry refresh semantics are not specified. */
  timestampUnit: "seconds" | "milliseconds";
  maxAgeMs: number;
  maxFutureSkewMs: number;
  now?: () => number;
  /**
   * Atomically authorize the current account/binding, deduplicate and enqueue a
   * generation-bound refresh. Reauthorize at execution. Honor signal; never run
   * provider work here. Resolve only after durable enqueue/duplicate proof.
   */
  enqueueRefresh: (
    hint: BoatWebhookHint,
    context: { signal: AbortSignal },
  ) => Promise<"scheduled" | "duplicate" | "ignored">;
}
const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
function response(status: number) {
  return new Response(status === 204 ? null : "Webhook refused", {
    status,
    headers: { "Cache-Control": "no-store", "Content-Type": "text/plain" },
  });
}
class Refusal {
  constructor(readonly status: number) {}
}
async function rawBody(request: Request, signal: AbortSignal) {
  const reader = request.body?.getReader();
  if (!reader) throw new Refusal(400);
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      if (signal.aborted) throw new Refusal(503);
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > bodyLimit) {
        cancel();
        throw new Refusal(413);
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** Optional host ingress; no webhook registration, native calls or component writes. */
export function createBoatWebhookHandler(options: BoatWebhookOptions) {
  if (
    !options ||
    !identifier(options.accountId) ||
    !identifier(options.endpointId) ||
    !Array.isArray(options.signingKeys) ||
    options.signingKeys.length < 1 ||
    options.signingKeys.length > 2 ||
    options.signingKeys.some(
      (key) =>
        !(key instanceof Uint8Array) ||
        key.byteLength < 16 ||
        key.byteLength > 1024,
    ) ||
    !["seconds", "milliseconds"].includes(options.timestampUnit) ||
    !Number.isSafeInteger(options.maxAgeMs) ||
    options.maxAgeMs < 1 ||
    options.maxAgeMs > 86400000 ||
    !Number.isSafeInteger(options.maxFutureSkewMs) ||
    options.maxFutureSkewMs < 0 ||
    options.maxFutureSkewMs > 60000 ||
    (options.now !== undefined && typeof options.now !== "function") ||
    typeof options.enqueueRefresh !== "function"
  )
    throw new TypeError("Invalid Boat webhook configuration");
  const {
    accountId,
    endpointId,
    timestampUnit,
    maxAgeMs,
    maxFutureSkewMs,
    enqueueRefresh,
  } = options;
  const now = options.now ?? Date.now;
  const keys = options.signingKeys.map((key) => new Uint8Array(key));
  return async (request: Request): Promise<Response> => {
    const controller = new AbortController();
    const signal = controller.signal;
    let finish: (value: Response) => void = () => {};
    const aborted = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    const abort = () => {
      controller.abort();
      finish(response(503));
    };
    const timer = setTimeout(abort, budgetMs);
    request.signal.addEventListener("abort", abort, { once: true });
    try {
      if (request.signal.aborted) return response(503);
      return await Promise.race([
        aborted,
        (async () => {
          if (request.method !== "POST") return response(405);
          if (
            !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
              request.headers.get("Content-Type") ?? "",
            ) ||
            ![null, "identity"].includes(
              request.headers.get("Content-Encoding"),
            )
          )
            return response(415);
          const length = request.headers.get("Content-Length");
          if (
            length !== null &&
            (!/^\d{1,8}$/.test(length) || Number(length) > bodyLimit)
          )
            return response(413);
          const deliveryId = request.headers.get("X-Ascii-Delivery") ?? "";
          const event = request.headers.get("X-Ascii-Event") ?? "";
          const timestamp = request.headers.get("X-Ascii-Timestamp") ?? "";
          const signature = request.headers.get("X-Ascii-Signature") ?? "";
          if (
            !/^evt_[a-f0-9]{32}$/.test(deliveryId) ||
            !events.has(event) ||
            !/^\d{1,16}$/.test(timestamp) ||
            !/^v1=[a-f0-9]{64}$/.test(signature) ||
            !/^[1-8]$/.test(request.headers.get("X-Ascii-Attempt") ?? "")
          )
            return response(401);
          const sentAt =
            Number(timestamp) * (timestampUnit === "seconds" ? 1000 : 1);
          const receivedAt = now();
          if (
            !Number.isSafeInteger(sentAt) ||
            !Number.isSafeInteger(receivedAt) ||
            receivedAt - sentAt > maxAgeMs ||
            sentAt - receivedAt > maxFutureSkewMs
          )
            return response(401);
          const bytes = await rawBody(request, signal);
          const prefix = encoder.encode(`${deliveryId}.${timestamp}.`);
          const signed = new Uint8Array(prefix.length + bytes.length);
          signed.set(prefix);
          signed.set(bytes, prefix.length);
          const digest = new Uint8Array(
            (signature.slice(3).match(/../g) ?? []).map((value) =>
              Number.parseInt(value, 16),
            ),
          );
          const matches = await Promise.all(
            keys.map(async (key) => {
              const imported = await crypto.subtle.importKey(
                "raw",
                key,
                { name: "HMAC", hash: "SHA-256" },
                false,
                ["verify"],
              );
              return crypto.subtle.verify("HMAC", imported, digest, signed);
            }),
          );
          if (!matches.some(Boolean)) return response(401);
          let body: Record<string, unknown> | undefined;
          try {
            body = record(
              JSON.parse(
                new TextDecoder("utf-8", { fatal: true }).decode(bytes),
              ),
            );
          } catch {
            return response(400);
          }
          const sandbox = record(record(body?.data)?.sandbox);
          if (
            body?.id !== deliveryId ||
            body.type !== event ||
            typeof body.createdAt !== "string" ||
            body.createdAt.length > 64 ||
            !Number.isFinite(Date.parse(body.createdAt)) ||
            typeof sandbox?.id !== "string" ||
            !/^bx_[23456789abcdefghjkmnpqrstuvwxyz]{8}$/.test(sandbox.id) ||
            typeof sandbox.name !== "string"
          )
            return response(400);
          if (signal.aborted) return response(503);
          const result = await enqueueRefresh(
            {
              accountId,
              endpointId,
              deliveryId,
              provider: "boat",
              providerId: sandbox.id,
              event,
            },
            { signal },
          );
          return response(
            !signal.aborted &&
              ["scheduled", "duplicate", "ignored"].includes(result)
              ? 204
              : 503,
          );
        })(),
      ]);
    } catch (error) {
      return response(error instanceof Refusal ? error.status : 503);
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", abort);
    }
  };
}
