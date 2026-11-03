# Lifecycle orchestration

Construct `providers.lifecycle(createLifecycleStore(ctx, components.sandbox))`
inside a trusted host action. `ctx` supplies Convex runQuery/runMutation; the
component persists state while action-local adapters call SDKs. Host wrappers
must authenticate callers and derive authorized scopes. No public HTTP webhook
or unauthenticated application endpoint is installed by this package.

The lifecycle helper exposes create, get, run, refresh, reconcileCreate,
reconcile and observe. `run` accepts start, stop or delete. Start selects
resumeMemory when the current observation is paused, and requires that explicit
capability/implementation. Stop invokes stop, never delete. It promises only the
selected adapter's reported persistence behavior. Delete becomes a tombstone
only when deleted state is observed. Existing tombstones are not recreated.

## Adapter contract

Lifecycle adapter methods return `{ providerId, state, resources? }`. Optional
methods are create, start, resumeMemory, stop and delete. They receive a context
with an AbortSignal and stable idempotency key. Core validates/project results
and normalizes SDK exceptions before persisting common codes. Adapter instances,
credentials, provider response bodies and create options never cross component RPC.

Advertising create requires `createIdempotency: "native"` or `"none"` on the
registration and a create implementation. Native means the provider itself
honors the key, not that core can guarantee exactly-once effects. Keys include
scope, logical key, provider, operation kind and caller-generated operation ID.
Adapters may hash/encode the key to meet provider limits without changing its
identity. Never reuse operation IDs for different requests.

Create options contain only optional resources and a native template ID.
Provider-specific configuration/credentials belong in the adapter's trusted
constructor, not a shared catch-all options object. Reference-bound authorization
runs before operation admission. Creation and create reconciliation also require
an explicit `authorizeCreate` callback; the ordinary reference callback cannot
authorize an unbound machine. Input identity/options are snapshotted before awaits.

## Durable creation

A provisioning claim is reserved transactionally before any SDK create call.
It exists without a fake provider ID. Concurrent callers for one logical key
cannot both dispatch. Repeating the retained operation ID returns the claim;
a different ID cannot replace unresolved provisioning. An existing bound key
returns its registry record, including tombstones, without another create.

`create` returns a bound/provision discriminated result. Provision status is
running, unknown, succeeded or failed. A known refusal with not_started outcome
records failed and permits a fresh operation ID. Other failures, timeouts and
malformed/lost replies remain unknown. An SDK call is never automatically repeated,
even when native idempotency is declared. Persistence errors propagate while the
claim retains the operation identity for later reconciliation.

The claim holds a 30-second versioned lease. A reply after lease expiry cannot
publish a binding. `reconcileCreate` can take over an expired lease or an unknown
claim. It calls only the optional `findCreate(idempotencyKey, context)` hook.
Adapters must correlate the result to that key and the correct provider account.
A missing hook, lookup miss or lookup failure never proves that no machine exists;
the claim remains unknown. Core never repeats create to test that assumption.
Once found, the result is bound transactionally. The caller can then request delete
to clean up that resource. Without a reliable lookup, resolution is explicit host
or operator work. The latest provisioning claim is retained per logical key;
failed attempts may be replaced, and their old IDs must not be replayed.

## Operation leases and observations

A bound lifecycle action reserves an operation, then atomically claims pending
work as running before its single SDK call. Repeated action calls cannot acquire
the same operation version twice. An interruption before claiming leaves pending
work, which an explicit replay of that same action ID may claim. An interruption
after claiming leaves running work; reconciliation observes instead of redispatching.

Worker leases last 30 seconds. Completion checks operation version, binding
generation, active reservation, lease expiry and the observation sequence captured
when the lease was acquired. A newer observation makes an older worker response
ineligible to overwrite state; the operation remains unknown for reconciliation.
An expired or replaced worker cannot publish completion. Existing generic state
transitions also reject expired leased workers.

Provider result and operation outcome are committed in one mutation. Reaching
the requested state completes the operation. Transitional observations retain an
unknown outcome and active reservation, ready for a status read. Read failures
during reconciliation cannot turn the original side effect into a known failure.
A confirmed terminal result releases the reservation. No resource state is
invented from a successful HTTP acknowledgement.

SDK calls have a five-second default deadline; polling allows up to ten seconds
per read. Abort is best-effort and does not prove a mutation was cancelled. A
late reply is ignored and cannot release an unknown reservation. Providers that
provision asynchronously should return a starting observation and support lookup
or status reads, rather than block until the machine boots.

## Bounded reconciliation and events

`reconcile` supports lifecycle operations only. It never invokes create, start,
resume, stop, delete or an execution command. It claims reconciliation work and
reads describe. Defaults are three attempts, 250ms initial delay, 2s maximum
delay, 10s elapsed budget and 5s per read. Policy limits are ten attempts, 30s
maximum delay, 120s elapsed budget and 10s per read. Backoff doubles to its cap.
Terminal outcomes, active leases or exhausted budgets stop the loop. Exhaustion
retains unknown state; it does not silently retry later. Host scheduling can call
these hooks again. The component installs no recurring polling job.

`refresh` allocates a refresh ticket before reading provider state. `observe`
applies a supplied ticket and validates identity/state through the registered
provider boundary after authorization. It rejects duplicate, superseded and
old-generation observations. A webhook wrapper must verify its provider signature
and ownership, decode through its adapter and correlate event ordering to a
server-owned ticket before calling observe. Do not allocate a new ticket merely
because an old webhook arrived; arrival order is not provider event order. Adapters
without reliable event ordering can schedule a fresh authoritative refresh.

All tests use synthetic adapters and anonymous local component backends. Actual
provider endpoints, webhook verification and provider-specific lookup semantics
remain separate integration projects. Public application authentication wrappers
and command execution have their own baseline work.
