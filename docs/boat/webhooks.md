# Optional Boat webhook ingress

`createBoatWebhookHandler` is an optional server-only helper exported from
`@fantastic.dev/convex-sandbox/boat`. It verifies raw deliveries and calls one
host-owned enqueue hook with a small refresh hint. It registers no endpoint with
Boat, starts no scheduler, performs no provider request and writes no component
state. Explicit refresh remains available without webhooks. This helper does not
resolve the outstanding live fork qualification gate.

## Wire contract and host policy

The [Boat OpenAPI](https://docs.boat.dev/openapi/boat-v1.yaml), reviewed on
2026-11-06 with SHA-256
`e04e5661c64fd271508a7365c5df1bd6392ed7f8b167a07abaa8c4a2ee984c49`,
specifies HMAC-SHA256 over the exact bytes of
`delivery_id.timestamp.raw_body`. Headers are `X-Ascii-Delivery`,
`X-Ascii-Timestamp`, `X-Ascii-Signature` with `v1=<lowercase hex>`,
`X-Ascii-Event` and `X-Ascii-Attempt`. Supported events are ready, error, archived,
hydrated, degraded and recovered under the `sandbox.` prefix. Delivery is at
least once, may be out of order and requires a 2xx response within five seconds.

This review covers webhook ingress only. It does not replace the separately
pinned native deletion contract in [live verification](live-verification.md).
The reference does not specify timestamp units, whether retries receive a fresh
signature timestamp, or a maximum retry horizon. The host must explicitly select
`timestampUnit`, `maxAgeMs` and `maxFutureSkewMs` after confirming its delivery
configuration. There is no automatic seconds/milliseconds detection or default
freshness window. Old signed retries outside the chosen window return 401;
provide bounded explicit reconciliation for missed hints rather than weakening
signature checks. This timestamp policy has offline coverage, not a live delivery
qualification claim.

Configure one active raw HMAC key and optionally one previous key as `Uint8Array`
values. No implicit hex, base64 or prefix decoding occurs. Decode the provider's
secret format in trusted host code after verifying that format. The helper copies
the bytes and checks signatures using Web Crypto verification. Keep the endpoint
identity stable across rotation. Remove the old key after the host's chosen
overlap period, and retain deduplication receipts for as long as accepted replay
is possible. Key provisioning, storage, rotation and webhook registration remain
host responsibilities; never use a Boat API key as the signing key.

## Checked HTTP action wrapper

This wrapper deliberately requires the host's authenticated routing and durable
scheduling implementation. It is not an installed endpoint or a complete replay
store. Keep this module in the server; never expose signing material through
public arguments or frontend configuration.

```ts convex/boat-webhook.ts
import { httpAction, type ActionCtx } from "./_generated/server.js";
import {
  createBoatWebhookHandler,
  type BoatWebhookHint,
  type BoatWebhookOptions,
} from "@fantastic.dev/convex-sandbox/boat";

export function boatWebhookAction(
  config: Omit<BoatWebhookOptions, "enqueueRefresh">,
  enqueue: (
    ctx: ActionCtx,
    hint: BoatWebhookHint,
    context: { signal: AbortSignal },
  ) => ReturnType<BoatWebhookOptions["enqueueRefresh"]>,
) {
  return httpAction(async (ctx, request) => {
    const handle = createBoatWebhookHandler({
      ...config,
      enqueueRefresh: (hint, context) => enqueue(ctx, hint, context),
    });
    return handle(request);
  });
}
```

Mount the resulting action on a host-selected HTTP route. Load keys and select the
account from trusted endpoint configuration, never a body field, URL parameter or
caller-selected organization. The native event body provides no authenticated
account ID; the configured signing subscription/key ring must identify the account.
Never reuse one key across independently authorized account endpoints.

## Enqueue and worker contract

`enqueueRefresh(hint, { signal })` receives only the configured `accountId` and
`endpointId`, the signed `deliveryId`, literal provider `boat`, signed sandbox
`providerId`, and the checked event type. Raw body, sandbox name, state, reason,
createdAt, signature and signing keys are not passed through.

The host must atomically perform these steps in its own durable transaction:

1. Resolve the exact account/provider/sandbox ID to a currently authorized logical
   binding. Reject unbound, foreign-account or tombstoned bindings. Do not route by
   display name or trust event state. A valid signature establishes origin, not
   tenant permission.
2. Deduplicate by account, stable endpoint identity and delivery ID. Concurrent
   duplicates must not enqueue twice. A receipt must not survive a failed enqueue
   as a false success. Do not key by timestamp, attempt, signature or rotation key.
3. Capture the current generation and reference and enqueue one bounded internal
   refresh job with those nonsecret identities. Return `scheduled` only after
   durable commit, `duplicate` only for an already committed receipt, or `ignored`
   for a definitively unauthorized/unbound event. Storage or scheduling failures
   must throw so the response remains retryable.

When the job runs, resolve current tenant authority and binding again. Require its
provider, native ID and generation to match the queued identities before calling
`lifecycle.refresh`. Use the existing registry sequence/generation fences and one
bounded read, never apply `event.data.state`, replay an unknown mutation or install
a second settling loop. Reordered events then request current observations rather
than overwriting newer state with old event data.

The two-second handler budget covers body reading, verification and the enqueue
hook. Bodies are bounded to 64 KiB before JSON parsing; malformed signatures and
mismatched header/body IDs/types never dispatch. JSON with optional UTF-8 charset
is accepted; compressed bodies are refused. The hook receives an abort signal and
must observe it before committing. On timeout or request cancellation, the handler
returns 503 and does not start another callback. JavaScript cannot preempt a host
callback that ignores cancellation; durable atomic deduplication must also make a
late commit safe when Boat retries. Host infrastructure must budget ingress and
response overhead within Boat's five-second limit.

Acknowledged scheduled, duplicate and ignored deliveries return 204. Invalid
headers/signatures or freshness return 401, invalid signed JSON/schema returns
400, oversized bodies return 413, and unsupported content types/encodings return 415. Host failures and timeouts return a fixed 503 response. All responses use
`Cache-Control: no-store`; exceptions and payloads are never echoed or logged by
the helper. Keep replay receipts and scheduling metadata in the host; generic
component records retain only the existing safe registry observations.

## Verification

`tests/boat/webhooks.test.ts` uses independently generated Node HMAC fixtures and
synthetic host callbacks. It covers byte tampering, rotation/retirement, malformed
headers, stale/future timestamps, body identity, size limits, fixed errors and
bounded scheduling. The synthetic queue in `example/fixtures/boatWebhook.ts`
demonstrates deduplication, foreign/unbound rejection, generation checks and
current authoritative refresh. That in-memory proof is not a production durable
scheduler or replay store. The same proof runs in both owned anonymous Convex
backends, including the packed-package host, through the existing CI integration.
No live registration, delivery, signing secret or Boat provisioning is used.
