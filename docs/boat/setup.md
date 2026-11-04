# Experimental Boat adapter

The optional `@fantastic.dev/convex-sandbox/boat` entry currently implements
`create`, `describe`, `start`, `stop`, `delete` and detached `execute`. Files, images and
connections remain unsupported. It is not a live-qualified provider release.
The playground continues to use the simulator.

Install the exact audited SDK alongside the component when using this entry:

```sh
pnpm add @boatdev/sdk@1.13.0
```

The SDK is an optional peer. Core and simulator consumers do not need it. Browser
imports of the Boat entry fail; the `convex` condition selects its server entry.
An import guard helps prevent accidental bundling and does not replace application
authorization or prevent credentials from being exposed by an unsafe host wrapper.

## Configure in the trusted host

Construct inside the action after authenticating and authorizing the caller. Read
the key from backend deployment configuration. The following is a fragment inside
an already authorized action, not a public endpoint or complete auth policy:

```ts
import { createBoatProvider } from "@fantastic.dev/convex-sandbox/boat";

const boat = createBoatProvider({
  apiKey: process.env.BOAT_API_KEY!,
  org: "personal",
  machineType: "small",
  ttlSeconds: 3600,
});
// Register boat in the existing SandboxProviders configured with host authorization.
```

Use an application-authorized logical key or existing binding. A provider ID,
wallet name, credential or tenant scope supplied by a browser is not authorization.
The factory does not query account credentials, import secrets into guests, or
change Boat's active organization. Configuration is captured at construction.
The default wallet scope is explicitly `personal`; set a host-approved organization
ID/name for another wallet. The fixed API origin is `https://boat.dev/api/v1`.

Never put the key in `VITE_*`, browser payloads, guest files/environments, registry
records, operation history or error strings. See [host security](../security.md).
Native Boat account permissions remain in force. `X-Boat-Org` scopes a wallet;
it does not create a per-user authorization boundary.

`fetch` may be supplied only by trusted host code for instrumentation/testing.
It must not replay mutations or log credentials. The adapter always injects fetch
into the SDK, disallows redirects, and excludes SDK retry/polling middleware.

## Create through the shared lifecycle client

Register the configured Boat provider in an application-owned `SandboxProviders`
with real `authorize` and `authorizeCreate` policies. Construct its lifecycle
client with `createLifecycleStore(ctx, components.sandbox)` and call
`lifecycle.create({ sandbox, provider: "boat", operationId })`. Derive `sandbox`
from verified ownership and keep the operation ID stable for the same request.
Do not call the raw adapter's create method as a replacement for shared claims.
See [the lifecycle contract](../lifecycle.md).

Concurrent requests for one logical key use the shared reservation and produce
one native POST. A returned native ID is bound with its observed state, which may
still be starting. A successful creation claim means the ID was obtained, not
that the machine is ready. Use shared `refresh(sandbox)` to observe readiness.

Host configuration selects `small`, `default`, `large` or `xlarge`; default is
`small`. The provider enforces plan eligibility. `ttlSeconds` is an integer from
1 through 2592000, default 3600. It requests an auto-stop deadline after creation,
not an inactivity timeout or a guaranteed maximum lifetime. There is no disabled
auto-stop option in this initial entry. Generic `CreateOptions.resources` requests
and templates are rejected rather than silently ignored or translated using an
unverified size table.

Creation explicitly sets `noEnv: true`, `visibility: "private"` and
`snapshots: true`. It passes no account environment, guest credentials, setup
script, repository list or agent prompt. This version exposes no account-secret
inheritance override. Snapshot capture/retention still depends on Boat and account
policy; no disk or memory persistence guarantee is advertised here.

Boat limits native idempotency keys to 255 characters. The adapter maps the shared
operation key to `csb-boat-v1-` followed by its SHA-256 UTF-8 digest, preserving a
bounded deterministic identity without putting raw tenant values in the header.
Keep this mapping and host size/deadline configuration stable for an operation.
Trusted scopes/operation identities must be unique within the provider account;
namespace application/deployment identities when sharing credentials across apps.
Native create idempotency is scoped to the account, matching body and a 24-hour
retention window. It is not an unlimited exactly-once guarantee.

There is no audited authoritative read-only lookup by native key, so `findCreate`
is absent. After a lost, timed-out or malformed successful create reply, shared
reconciliation retains unknown and does not repeat POST, even after key expiry.
A new operation cannot bypass an active unknown creation. Resolve it explicitly
through approved host/operator recovery rather than a name match, list scan or
another creation attempt. Restart recovery relies on the shared persistent store,
not adapter memory. Native IDs acquired before a crash can still require operator
recovery if their binding was not persisted.

## Stop, resume and deletion

Use shared `lifecycle.run` and bounded `lifecycle.reconcile` for mutations. Stop
calls the native stop endpoint with `force: false`; there is no forced-stop option
or fallback to delete. Pending/failing stops remain transitional. The raw SDK
response is used because SDK 1.13.0's action model omits a top-level stop handle;
both top-level and nested stop IDs are validated, and conflicting IDs are rejected.
Accepted handles are persisted before further status reads. Historical completed
or superseded stops are checked against the current VM, so an externally resumed
machine is not reported stopped from an old job alone.

Start calls Boat's disk resume endpoint, preserves the current native size and
requests the host-configured auto-stop deadline. It sends `noEnv: true`: Boat can
scrub inherited owner secrets from a restored machine, a one-way native safety
setting. This entry targets no-env guests; authorize imported bindings with that
behavior in mind. It does not replace per-sandbox env or select another account
environment. Request acceptance remains starting until a later readiness read.

Stop ends running processes and discards RAM. Normal native stop saves disk, but
snapshot/retention/account settings affect recovery. Capabilities therefore report
`memoryOnStop: "discarded"` and `diskOnStop: "unknown"`, with no retention SLA.
Memory suspend/resume is unsupported. Auto-stop remains a deadline, not inactivity
detection, and no preservation claim follows merely from a successful stop.

Delete sends `X-Ascii-Confirm-Delete` for the bound VM and stores the returned job
ID in the shared operation. Pending, processing and blocked deletion remain
unfinished even though sandbox lookup may already return 404. Only the native
job's completed status, matching both job ID and sandbox target/kind, permits a
deletion observation and retained tombstone. Read-only reconciliation works after
restart without repeating DELETE. A missing job, lost reply or malformed response
remains unknown; 404 alone is never completion. Saved snapshots can remain
independent of sandbox deletion under Boat's native policy.

## Detached commands

Use `providers.execution(createExecutionStore(ctx, components.sandbox))` after
host authorization and start with a stable shared operation ID. The adapter uses
native detached command start and command-history reads only. The durable handle
is Boat's command ID, never a process ID. Start has no native idempotency key or
authoritative lookup by our operation key. A lost reply or missing command ID
therefore remains unknown; repeated start/status calls do not redispatch it.
If a native ID is received but not persisted before a crash, operator recovery
can still be necessary. There is no exactly-once execution claim.

Shell input is intentional shell text. Argv input is translated to POSIX quoted
literal tokens through `/usr/bin/env --` to select an external executable rather
than a shell builtin. Executable names containing `=` are rejected because env
would interpret them as assignments. The guest must provide `/usr/bin/env` and
a POSIX-compatible shell. Relative cwd is passed as a native field; absolute cwd
and parent traversal are unsupported. This validation is not a filesystem jail:
symlinks and executed code remain subject to the guest's own permissions.

Per-command env and timeoutMs are rejected before dispatch. The audited native
request cannot represent env, and detached commands have no native runtime cap;
the HTTP deadline does not terminate a process. Mapped command text is limited to
64 KiB UTF-8 after quoting, with malformed Unicode rejected.

A later status call verifies both command and sandbox IDs and detached mode.
Exited commands with an integer exit code are completed, including nonzero exits
(which the shared operation marks failed). Timed-out/killed commands are failed,
without inventing a cancellation acknowledgement. Lost, ambiguous failed, future
states and missing exit codes remain unknown. Missing/expired history is stale,
not completion; native retention or disabled monitoring can remove history.
Command identity persists across host restart, but VM stop/restart ends processes
and does not resume command execution. Status projects no command text or output.
Logs and cancellation remain unsupported pending their separate integration.

## Transport bounds and errors

- Each adapter call has a five-second deadline, even when used directly without
  a shared lifecycle client. Caller aborts reach the HTTP signal and response
  reader. The returned promise settles even if a custom fetch ignores abort.
- Successful response bodies are capped at 1 MiB before SDK JSON decoding.
  Oversized or invalid observations fail safely. There is no claim that every
  future command/file method fits this response policy.
- HTTP error bodies are canceled without parsing. Shared codes are classified by
  status: 400/413/422 validation, 401 authentication, 402 quota, 403 authorization,
  404 stale resource, 429 rate limit, 408/504 timeout and 503 capacity. Unknown
  statuses and lost replies remain unknown outcomes. Raw provider messages,
  response bodies, URLs, causes and native error codes are not returned.
- Known request rejections have `not_started` outcome. A timeout, lost reply or
  ambiguous server/conflict response during a mutation does not prove that it
  failed to start. It remains unknown and is never automatically replayed.
  Retryability metadata is advice, not a retry loop. Retry-After hints and
  native error-body subcodes are not currently projected.
- Observation maps init/provisioning/provisioned/cloning to starting,
  ready/idle/running to running, archiving to stopping, archived to stopped,
  and error/cancelled to error. Future state strings map to unknown.
  Extra fields and error text are omitted. Explicit native `vcpu` is projected to
  `cpuCount`. Memory/disk remain unknown: the reviewed memory field is labeled GB,
  without an established GB/GiB conversion, and no explicit disk allocation field
  is mapped. No resource value is guessed from the machine class.

The adapter adds no table, operation ledger, scheduler or recovery loop. Shared
registry and operation clients keep their existing ownership. A missing sandbox
is reported as stale rather than inferred to be confirmed deletion.

## Verification and next steps

`tests/boat/transport.test.ts` covers host configuration, projection, aborts,
deadline/body bounds, lost replies and safe status errors using injected fetch.
Package tests reject browser imports and block SDK resolution from core/testing.
The internal `boatProbe:transport` action uses the public entry with synthetic
fetch and runs on both owned anonymous Convex backends during qualification,
including the packed-package backend. No live credentials or Boat resources are
needed. Live qualification remains a separate explicitly budgeted gate.

`tests/boat/provision.test.ts` also uses the actual shared component to check
concurrent claims, safe creation and missing-lookup recovery beyond key expiry.
`boatProbe:provision` exercises the public factory and store bridge on both
anonymous backends with synthetic HTTP. These internal qualification fixtures
expect a fresh disposable backend; they do not operate existing Boat machines.

`boatLifecycleProof` covers native stop, resume and pending deletion with the
shared store, then confirms deletion in a new action after backend restart. All
HTTP replies are synthetic; no account key or billable resource is needed.

See the [source and capability decision](decision.md) before adding operations.

`boatExecutionProof` persists known and lost detached starts, then reconciles in
a new action after restart without POST or sibling-backend state crossover.
