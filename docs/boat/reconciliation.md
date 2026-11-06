# Boat refresh and reconciliation

The adapter uses the existing shared registry and operation clients. It adds no
Boat table, installed webhook receiver, settle scheduler or background polling process.
Construct the public Boat factory inside trusted host actions, authenticate and
authorize the application binding, and keep account credentials in host config.

## Explicit host hooks

Use the existing shared store bridge and authorized providers instance:

```ts
const lifecycle = providers.lifecycle(
  createLifecycleStore(ctx, components.sandbox),
);
await lifecycle.refresh(sandbox);
```

Refresh makes one native describe call and writes the projected observation through
the registry ticket protocol. It does not infer a mutation's outcome or replay it.
External archived state becomes stopped; ready/running/idle becomes running.
Machine state/resources are visible through existing reactive registry queries.
No browser or guest needs the master API key. A missing native VM reports stale
resource and retains the prior observation, not a confirmed deletion. Deletion
still needs its matching native deletion job, as described in [setup](setup.md).

For an existing admitted lifecycle operation, call bounded reconciliation:

```ts
const operation = await lifecycle.reconcile({
  sandbox,
  operationId,
  policy: { maxAttempts: 1, maxElapsedMs: 2000, callTimeoutMs: 1500 },
});
```

The host decides whether and when to invoke another action. A manual refresh,
application event or host-owned scheduler can call these hooks; the adapter does
not register a cron or copy the upstream component's independent settle loop.
Pass host-authorized logical identities and retained operation IDs to scheduled
work, resolve ownership again when it runs, and keep credentials out of job args.
Choose a finite retry/backoff/cancellation policy and avoid repeating mutation IDs
after history expiry. Unknown outcomes do not authorize another POST or DELETE.

Refresh and the Boat HTTP transport have five-second call bounds. Reconcile also
limits attempts, delays, elapsed polling budget and per-call time; the smaller
remaining call budget wins. A transitional response returns control with the
operation unfinished when its budget is exhausted. The existing policy validates
at most 10 attempts, 30-second max delay, two-minute elapsed budget and ten-second
requested call timeout; Boat's own transport still caps each call at five seconds.
Host authorization/store RPC overhead and a custom wait callback are host code,
not preemptible native HTTP work. Budget those within the action's own deadline.
SDK abort is forwarded and local timers are cleared; it does not prove a remote
mutation stopped or cancel a native provider job. No settling continues locally
after the client returns.

## Request ordering and machine generations

Every refresh reserves a sequence under the current machine generation. A newer
refresh invalidates older replies, including older failures; arrival order does
not overwrite the latest accepted ticket. A failed current refresh preserves the
previous observed state and records the safe error code. These fences order host
requests, not the provider's global event timestamps or a transactional snapshot
of external activity.

Lifecycle reconciliation shares these sequence fences and persists accepted native
job handles. A newer ordinary refresh may supersede an older state observation
without discarding its accepted job identity. After confirmed deletion and an
explicit versioned rebind, an old generation cannot update the replacement VM.
The host must still authorize the current binding. Never route by display name,
assume a 404 proves deletion, or replace generation checks with a provider label.

## Optional webhook hints

The [webhook ingress helper](webhooks.md) verifies signed raw deliveries and
passes a minimal account-scoped hint to a host-owned enqueue hook. Hosts retain
registration, signing keys, timestamp policy, atomic durable deduplication,
binding authority and scheduling. No endpoint or scheduler is installed by the
factory. Events trigger bounded authoritative refresh rather than direct state
writes. Explicit refresh qualification does not depend on live webhook setup.

## Deterministic qualification

The provider tests cover external refresh, reversed success/error replies,
confirmed deletion/rebind fencing, failed reads preserving state, attempt/elapsed
budgets, and a hung native read that aborts with no remaining timers or replay.
The internal boatReconcileProof uses synthetic HTTP and the public factory/shared
stores. scripts/boat/qualify-refresh.mjs starts an owned local CLI query watch,
observes running, invokes a read-only external-stop refresh, then requires the
subscription to emit stopped. Its watcher has a deadline and is stopped by its
owned child handle. Both anonymous and packed hosts run it in qualification.
No live Boat request, guest machine, webhook or credential is used.
