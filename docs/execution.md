# Command and background execution

Construct `providers.execution(createExecutionStore(ctx, components.sandbox))`
in a trusted host action. The store bridge sends serializable metadata to the
component; SDK calls remain in the host. Authenticate and derive trusted logical
scopes before invoking it. No agent loop, approval UI, guest supervisor, shell
service or recurring polling job is installed.

## Adapter and command contracts

Advertise `execute` and implement `adapter.execution.start/status` with an explicit
`idempotency: "native" | "none"`. Optional hooks are find, cancel and logs. Cancel
and provider log access require separate `cancelExecution` and `executionLogs`
capabilities. Missing support fails before SDK dispatch. Cached get/log queries
still pass through authorization without requiring a live SDK capability.

`start` must return a provider execution ID promptly, with queued, running,
completed, failed, cancelled or unknown state. Native asynchronous job APIs belong
in adapters. A synchronous SDK that waits for a long process may exceed the SDK
deadline and leave an unknown outcome; core does not build a shell service to
make that SDK asynchronous. `status` and optional find must be read-only and must
never start/restart a command. Find must correlate the scoped idempotency key and
the correct provider machine/account. Native delivery guarantees remain provider
responsibilities.

Input is an explicit shell command or executable/argv, plus optional cwd, env and
runtime timeout. Shell text is never inferred from argv or concatenated by core.
NULs, sparse/non-string argv, unknown fields and oversized inputs fail validation.
Shell text and total argv have a 65,536-character limit; argv has at most 128
arguments of at most 4096 characters, and executable/cwd have a 4096-character
limit. Environment has at most 64 conventional variable names, values up to 8192
characters and 32,768 total name/value characters. Input is snapshotted before
awaiting authorization. Core reads no host environment variables for commands.

Runtime timeout is an integer from 1 through 3,600,000ms. It is forwarded to the
adapter for provider enforcement; it is distinct from SDK-request deadlines.
Adapters must honor it or reject unsupported requests honestly. Core does not
promise guest termination when a provider ignores a timeout or AbortSignal.

Commands, argv, cwd and environment values are not stored in component records.
Only identity, state and bounded output are persisted. Output can itself contain
sensitive application data, so host log wrappers must restrict access to owners.
Do not expose component callbacks as unauthenticated public application endpoints.

## Start once, then observe

`start({ sandbox, operationId, input })` returns a scoped execution record and
starts at most once while that operation is retained. Its stable public handle is
`{ sandbox, operationId }`; provider `executionId` is optional until known. The
record includes reference/generation, explicit state, optional exit code, common
error code, output byte count/truncation marker and cancellation state.

Reservation and execution metadata are created in one mutation. A pending
operation must claim its dispatch lease before any SDK start. Concurrent/repeated
calls cannot claim it twice. Unknown or running operations are never redispatched.
Callers must supply fresh operation IDs for distinct requests, including changed
commands/options, and never replay IDs after history expiry. This is not an
exactly-once guarantee from the provider.

SDK calls have a five-second deadline. A lost reply, timeout, malformed response
or interrupted action retains identity and uncertain state. A known not_started
refusal can become failed. Provider handles cannot change after attachment.
Expired lease replies and old-generation updates cannot publish. Optional find
can recover a handle; missing/failed lookup stays unknown without another start.
An interrupted pending reservation may be explicitly replayed with the original
input because no SDK start has been claimed yet. Input is deliberately not stored
for automatic recovery.

`get` reads cached metadata. `status` performs one bounded SDK read/lookup and
records the observation. A running process cannot be moved directly back to
queued by an older snapshot; terminal state cannot be reopened. A completed
process requires an integer exit code. Nonzero exit is completed process state
with a failed generic operation outcome. Failed means a known terminal service
or start failure; unknown means effects/completion cannot be established. Generic
operation state may retain delivery uncertainty until terminal confirmation;
execution state is the process observation to display.

`wait(handle + { maxWaitMs?, maxPolls? })` provides a short bounded wait: defaults
are 1000ms and five polls, with maximums of 5000ms and ten polls. Each status call
uses the remaining budget and 100ms intervals. It returns even if the process is
still queued/running/unknown. `run` combines start and short wait. Longer work
uses start, then separate status calls from the host's chosen scheduling system.
No wait or reconciliation path automatically repeats the command.

## Cancellation is not completion

`cancel` first records the caller's request, then attempts the provider cancel
hook once when an execution ID is known. The record separates requested intent
from acknowledgement: none, pending, accepted, rejected or unknown. Accepted
means the provider accepted the request, not that the process exited. Only a
provider status of cancelled confirms terminal cancellation and releases work.
If natural completion wins the race, completed/exitCode remain authoritative and
the cancellation acknowledgement remains visible.

Missing handles and lost cancel replies remain explicit uncertainty. A request
made before the handle arrives can be attempted by calling cancel again once it
is known; a dispatched cancel is not automatically retried. Expired pending
acknowledgements become unknown when cancel is checked again. SDK deadlines are
best-effort aborts, not proof a process was killed.

## Bounded output and cursors

`logs({ sandbox, operationId, cursor, limit? })` reads cached chunks with a numeric
component cursor and 1 through 16 entries per page. Entries identify stdout or
stderr. Its isDone means the current cache page is exhausted, not that the process
has finished. Native provider cursors and worker leases are not returned by general
execution queries.

`syncLogs` fetches at most one provider page: requests cap at 16 entries/16KiB.
Core also normalizes oversized responses, enforcing at most 4096 UTF-8 bytes per
chunk, 32 chunks and 65,536 total cached bytes per execution. Truncation markers
remain sticky when provider output or core limits drop data. Empty output uses
no chunk. Provider adapters must supply exclusive, non-overlapping, non-secret
cursors and distinguish temporary exhaustion from permanently complete output.
A non-empty non-final page must advance its cursor.

Terminal inline stdout/stderr snapshots are capped at 4096 bytes each. Core uses
either that initial inline snapshot or an already-started cursor stream, avoiding
cumulative duplicate output. Inline completion fences older in-flight log pages.
Status, log and cancel updates have separate versioned leases so late replies
cannot erase newer output or cancellation metadata. Log errors do not change
process state.

Operation history retains at most 100 records per logical sandbox. When an old
terminal operation expires, its execution metadata and at most 32 chunks are
removed transactionally too. Cached handles then resolve to null. Unresolved
execution cannot be evicted or completed through generic operation transitions;
it must use the execution protocol. No unbounded output document or table scan
is used. Provider log retention and resource cleanup are separate from cache
retention; deleting the cache is not cancellation of a process.
