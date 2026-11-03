# Registry and operation state

The component stores provider-neutral records. Host wrappers must authenticate
callers, resolve trusted scopes and authorize each reference before calling these
functions. Scopes and keys are opaque strings, with no account or bot topology.
Component functions are available to the host through `components.sandbox`; they
are not public application endpoints. No function here calls a provider SDK.

## Registry identity

`registry.ensure({ sandbox, reference })` atomically creates a logical identity or
returns its existing record when the reference matches. A conflicting reference
fails instead of replacing a machine silently. `registry.get({ sandbox })` returns
that record or null. `registry.list({ scope, paginationOpts })` lists only the
selected scope, including tombstones. All list queries require pagination with
1 through 100 items per page and bounded scan budgets.

Each record has a monotonically increasing `version` and a binding `generation`.
Requested state is running, stopped or deleted when a lifecycle operation records
that intent. Observed state comes only from a provider refresh. Completing an
operation does not invent a provider observation or imply the requested state
was reached. A failed start may therefore leave requested running and observed
stopped. UI callers must display refresh status and operation state as well.

Confirming provider state deleted creates a tombstone. Refreshes and new operations
cannot revive it. Tombstones remain addressable; this component does not hard-delete
them or forget their generation. `registry.rebind` requires the current version,
a tombstone and no unresolved active operation. It changes the reference, advances
the generation and resets observations and requested state. This is an explicit
new physical binding, not recovery of the deleted machine. Old-generation updates
cannot affect the new binding. Operation history retains its original references.

Logical scope/key and provider IDs must be non-empty and at most 1024 characters;
provider names are limited to 256. These are non-secret identifiers, never signed
connection URLs, access tokens or provider credentials.

## Refresh ordering

Call `registry.beginRefresh({ sandbox })` before starting an SDK observation in a
trusted action. It allocates a `{ generation, sequence }` ticket and marks refresh
pending. Complete it with `registry.finishRefresh` and the same logical identity
and ticket, plus either `{ state, resources? }` or `{ errorCode }`.

Only the current pending ticket may apply. Duplicate responses, superseded tickets
and old generations return false without changing observed state. A failed current
refresh preserves the last successful observation and records failed status with
a common error code. `observedAt` is the last successful application time; it is
not a provider timestamp. `observedSequence` and `refreshSequence` expose whether
the last observation predates a new refresh. Pending work is not automatically
expired; reconciliation is separate lifecycle work.

Mutating operations invalidate pending refresh tickets when they begin and on
operation transitions. This prevents a read started before an operation phase
from reporting stale data as fresh after it. The refresh status becomes stale
until the host obtains a new observation. Pure description/file-list/read and
metadata operations do not invalidate observations. Deletion tombstones remain
terminal regardless of later operation transitions. Refresh ordering uses
component-allocated tickets, never provider clocks.

## Operation invariants

`operations.begin({ sandbox, expectedVersion, operationId, kind })` reserves one
active operation for the logical sandbox. A version conflict or existing active
operation prevents a second reservation. The reservation stores pending status
and the physical reference/generation at that time. Lifecycle start, stop and
delete also set requested state. No SDK call occurs inside the mutation.

A repeated ID for the same generation and kind returns the retained operation,
even if the caller's expected registry version is old. It does not create another
operation. A different kind or generation with the same retained ID fails. Host
actions must inspect the returned status before any SDK call; receiving a record
is not permission to execute it again. IDs must be non-empty and at most 256
characters. The registry does not store or compare command arguments.

`operations.transition` uses the operation's own expected version. A stale update
returns false. The allowed transitions are:

| Current                      | Allowed next states                            |
| ---------------------------- | ---------------------------------------------- |
| pending                      | running, succeeded, failed, unknown, cancelled |
| running                      | succeeded, failed, unknown, cancelled          |
| unknown                      | succeeded, failed, cancelled                   |
| succeeded, failed, cancelled | none                                           |

Unknown means provider effects are uncertain. It keeps the active reservation
and cannot return to pending/running. The host must reconcile it to a confirmed
terminal result; a retry hint or UI cancellation request is not confirmation.
Succeeded, failed and confirmed cancelled release the reservation. Terminal
records cannot be reopened, including duplicate updates with a current version.
An execution ID can be attached only to an execute operation and cannot change.
It must be non-secret and at most 1024 characters. Generic errors are represented
only by a common error code, not SDK response bodies or free-form error messages.

`operations.get({ sandbox, operationId })` returns one scoped record or null.
`operations.list` paginates that logical sandbox's history newest first.
`operations.executions` uses a separate scoped index to paginate only execute
operations. Ordinary Convex queries make these records reactively subscribable
through authorized host wrappers. There is no polling loop in the component.

## Bounded history and limits

Each logical sandbox retains at most 100 operation records across generations.
Beginning a new operation at the limit atomically evicts the oldest terminal
record. Pending, running and unknown records cannot be evicted, and no new work
can begin while one is active. Pagination is bounded and uses compound indexes;
there are no table scans or unbounded collections.

An evicted handle resolves to null. ID deduplication lasts only while its record
is retained, so callers must generate fresh IDs and must not replay old requests
after history expiry. This is a bounded observation history, not an exactly-once
provider-effect ledger. Tombstones and their generation counters are retained
separately to prevent stale machine resurrection. Account quotas, retention-based
purging, scheduling and provider reconciliation policies remain host/later work.

The old `observations` table remains the narrow boundary proof used by the starter
example. New registry/operation APIs do not mirror that table. Use the new records
for lifecycle orchestration; the proof remains independently tested until the
example's integration work replaces it.
