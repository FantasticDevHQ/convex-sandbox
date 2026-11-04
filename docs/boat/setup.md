# Experimental Boat adapter

The optional `@fantastic.dev/convex-sandbox/boat` entry currently implements
`create`, `describe`, `start`, `stop`, `delete`, detached `execute` and
`executionLogs`, plus bounded `readFile`, `writeFile`, `listFiles` and `deleteFile`.
Native `fork` and source-scoped `listTemplates` are also available. Direct transfers,
image capture/restore and connections remain unsupported.
It is not a live-qualified provider release.
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
See the bounded history-log support and cancellation limitation below.

## History logs and cancellation limits

Call shared `execution.syncLogs(handle)` to cache a bounded page, then authorized
`execution.logs` to read it. Output is potentially sensitive; use the protected
host wrappers and the existing output authorization policy. Command status does
not implicitly fetch output. The history route reads stdout and stderr by durable
command ID even while the VM is stopped; running detached output can lag by about
30 seconds. Stream order is preserved within each stream, without claiming a
combined chronological ordering.

Each call makes at most two GETs within one five-second deadline. It requests
base64 with a byte limit, verifies command/stream/offset/size and byte counts,
and advances a versioned, identity-bound cursor in the existing shared store.
Offsets survive action and backend restart. No PID lookup or tail fallback is
used. Retries after a failed page reread from the last committed cursor; output
and offsets are published together only after both reads succeed. A conflict such
as agent_outdated remains an explicit log error, with no output/cursor advance.
The status-only error policy does not expose the native error-body subcode.
Missing offset fields also fail validation rather than inventing append cursors.

UTF-8 suffixes split at a read boundary are left at their native byte position
for the next read. Only complete characters are emitted until the stream is done;
invalid terminal bytes are replaced and flagged truncated. A provider retention
gap marks truncation. Backward offsets are rejected. The cursor contains only an
identity digest and two offsets, with no output, environment or credentials.
Native base64 bytes are exact; the text cache is a bounded UTF-8 view, not a binary
archive. BOM characters are preserved, including at page boundaries.

A page reads at most 1024 native bytes per stream. Decoded replacement expansion
is budgeted before reading, yielding at most two entries of at most 3072 UTF-8
bytes each. Low-level callers must request 2–16 entries and 24–16384 bytes; the
shared client uses 16 and 16384. The existing shared cache retains at most 64 KiB
and 32 chunks, then marks output truncated. Page completion means both log streams
are drained and ended, independently of execution state or cancellation.

Cancellation remains explicitly unsupported. The audited API accepts only a PID
and has no atomic command-ID or generation precondition. A history check followed
by DELETE would still risk stopping an unrelated process after PID reuse. The
adapter does not advertise cancelExecution, issue DELETE, or fabricate an
acknowledgement or final state. Generic acknowledgement-versus-completion handling
remains unchanged for providers that can cancel safely.

## Bounded inline files

Use `providers.files` with `createFileStore(ctx, components.sandbox)` and a
mandatory host authorizePath policy, as shown in [the file contract](../files.md).
The shared client authorizes the sandbox and path before HTTP dispatch, checks
bindings before returning, and applies the policy to each listed child. Calling
the low-level adapter bypasses host authorization; keep it inside trusted code.
The adapter also requires canonical absolute paths under `/home/user` or `/tmp`.
Boat retains its own canonicalized-path restrictions. A narrower host policy is
lexical and does not establish a symlink jail inside those provider roots; use
native guest permissions/isolation for that boundary. Returned paths must match
the requested path or listed child, otherwise the result fails conservatively.

This entry declares limits.maxFileBytes as 65536 bytes for inline files. Native
Boat allows 5 MiB, but the smaller adapter limit fits its bounded JSON transport.
Read requests always use native base64 and fetch a whole file, validate its exact
size/encoding, then slice the requested offset and maxBytes locally. This is not
native ranged streaming. Every continuation reads the file again and can observe
changes; no snapshot consistency is promised. Files above 64 KiB are rejected
rather than represented as successfully clipped whole-file reads. A very large
reply can hit the existing 1 MiB HTTP-body limit before its file size is decoded.
Offsets past EOF are rejected; at EOF a complete empty read is valid. Shared text
reads preserve BOM and UTF-8 partial-character boundaries.

Writes send exact base64 bytes and require successful matching path/encoding/size
before reporting complete. Lost or malformed mutation replies remain unknown,
with no automatic retries or file-operation deduplication guarantee. File data
and operation keys are not persisted in component records. Delete is native and
nonrecursive; deleting the provider roots is rejected. Symlink deletion follows
Boat's native semantics, deleting the link rather than its target.

Listing requests one native directory, with at most 100 projected entries. Boat
has no native pagination cursor. If the native response is truncated, has more
entries than requested, or host policy filters children, partial is true and
nextCursor is null. Supplied cursors fail unsupported before HTTP; callers can
request a narrower directory rather than assume another page exists. The native
listing and the HTTP response remain bounded; an oversized response fails rather
than creating a fake continuation.

Direct transferFile and both upload/download directions remain unsupported.
Boat's path-bound signed GET/PUT URLs have native expiry but explicitly no size
limit. The common contract requires an enforced byte bound; inventing maxBytes
metadata cannot constrain an upload or a changed download. The adapter mints no
URLs, proxies no content, adds no bucket/storage sync, and leaves the common
contract unchanged. There is no supported bearer handle to persist or expose.

## Forks and saved template catalog

Use the shared `providers.images(createImageStore(ctx, components.sandbox))`
client after host authorization. A fork uses the native fork API with a bounded,
stable digest of the shared image-operation key in Idempotency-Key. It sends
noEnv: true, env: {} and the configured finite ttlSeconds. This avoids inherited
account keys and per-sandbox environment variables, but a fork still copies source
disk data and inherits native settings such as machine size and monitoring.
Authorize that native copy and its resulting compute/storage costs explicitly in
your host policy. The adapter does not run an agent or rewrite guest files.

The returned child sandbox ID is persisted immediately in a versioned native
image-job handle, bound to the source ID, before any readiness read. A later
status action reads that child only. Starting states remain pending; running
states confirm a ready result with the new physical provider reference. Native
error states fail the fork; missing, stopped or unknown states retain uncertainty.
The initial 202 is never treated as ready. Source and child identities must be
different, and reply identities must match. No source registry rebinding or
automatic destination binding occurs; the host owns destination authorization,
registration and orphan cleanup. A fork's disk readiness implies no RAM restore.

A lost or malformed initial reply remains unknown with no inferred find lookup
or repeated POST, even though Boat supports native fork idempotency. A crash
between acquiring and publishing the child identity can still need operator
recovery. Shared operation retention and native idempotency windows are not an
unlimited exactly-once guarantee. Restart recovery reads the persisted child ID,
not adapter process memory or a name/list scan.

`listTemplates` calls the native saved-snapshot catalog and exposes only entries
whose sourceSandboxId matches the authorized bound VM. The host must still
authorize listing; this is not a provider-global catalog for arbitrary consumers.
References retain the native saved name and kind template. These names are
mutable: re-saving replaces the artifact. A reference does not pin an immutable
artifact, guarantee retention, or enable createFromTemplate in this entry.
Saving maps to pending, failed to failed, and ready requires a valid native
snapshotId. Missing artifacts or future statuses remain unknown. URLs, error
text, account allowance and other sources' entries are omitted.

The catalog is capped at 100 projected entries, bounded by the HTTP response
limit. Native saved-snapshot listing has no pagination: clipping is partial with
nextCursor null, and supplied cursors fail unsupported before HTTP. It can fail
on a large account response rather than fabricate a gap-free continuation.

snapshotDisk and createTemplate mutations remain unsupported. The audited saved
capture API can replace a name and provides no immutable capture-job/generation
ID while saving. A name alone, or the undocumented generation semantics of its
createdAt, cannot establish that the original request completed after replacement.
Background/stop disk captures are not substituted for explicit snapshotDisk.
Restore also remains unsupported: recover power-cycles the VM, and creating from
an image changes physical identity. The adapter performs neither substitute and
adds no artifact deletion, retention policy or cross-provider portability claim.

## Connection boundary

All connection kinds remain explicitly unsupported. The [per-kind native audit](connections.md)
explains the missing enforced expiry for desktop, preview and SSH and the lack of
a separate browser mapping. Access requests perform no native setup; observation
projection omits native bearer URLs. Machine auto-stop is not connection expiry.

## Host refresh and scheduling

Use existing shared lifecycle refresh/reconcile hooks. The [reconciliation guide](reconciliation.md)
explains request ordering, generation fences, polling budgets and optional host
scheduling. The adapter installs no settle loop. Authenticated native webhook
routing is tracked separately and is not implemented by this factory.

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

`boatLogProof` caches history output, then resumes native offsets after backend
restart without duplicated bytes, sibling changes or an inferred process exit.

`boatFileProof` runs the public factory and shared file-store bridge with synthetic
HTTP on both anonymous/packed hosts, including full 64 KiB binary encoding, UTF-8
partials, denied paths, list filtering, nonrecursive delete and transfer rejection.

`boatImageProof` persists a pending child identity and checks source-scoped
catalog readiness, then confirms the child in a new action after backend restart
without another fork POST, source rebinding or sibling state changes.
