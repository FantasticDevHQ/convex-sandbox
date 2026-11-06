# Experimental Boat adapter

For a compiled, authenticated consumer wrapper and a dated capability matrix,
start with the [Boat host guide](guide.md). This page records detailed native
semantics and configuration limits. For optional signed ingress, see the
[webhook host contract](webhooks.md).

The optional `@fantastic.dev/convex-sandbox/boat` entry currently implements
`create`, `describe`, `start`, `stop`, `delete`, detached `execute` and
`executionLogs`, plus bounded `readFile`, `writeFile`, `listFiles` and `deleteFile`.
Native `fork` and source-scoped `listTemplates` are also available. Direct transfers,
image capture/restore and connections remain unsupported.
It is not a live-qualified provider release. See the [candidate handoff](release.md)
for operation qualification and the unresolved release gate.
The playground continues to use the simulator.

Install the exact audited SDK alongside the component when using this entry:

```sh
pnpm add @boatdev/sdk@1.13.0
```

The SDK is an optional peer. Core and simulator consumers do not need it. Browser
imports of the Boat entry fail; the `convex` condition selects its server entry.
An import guard helps prevent accidental bundling and does not replace application
authorization or prevent credentials from being exposed by an unsafe host wrapper.

## Store the key in the Convex backend

`BOAT_API_KEY` is a server-side Convex deployment environment variable. A value in
a shell or local `.env` file is not automatically a backend environment variable.
Choose the intended development deployment before setting it. Do not select
production as part of local setup.

In a consumer application's configured Convex project, pass the value through
stdin from an authorized secret manager to `convex env set BOAT_API_KEY`. Never
pass the actual key as a command argument. Do not enter it in the interactive
prompt in a recorded terminal: the pinned CLI masks only the final display, not
the value while typing. The managed-checkout recipe below demonstrates stdin
injection without an interactive prompt. Verify names only:

```sh
pnpm exec convex env list --names-only
```

Verify only that the variable name exists. `convex env get BOAT_API_KEY` and
`convex env list --include-values` print secrets, so do not run them in recorded
terminals or copy their output into tickets, PRs or chat. Convex actions read the
stored key through `process.env.BOAT_API_KEY`.

### This repository's anonymous worktrees

This example uses checkout-local anonymous backends, not a shared cloud development
deployment. Start the intended checkout with `pnpm worktree:start` after its normal
setup. Each checkout has its own backend database and environment. Setting a key
in one checkout does not configure another checkout or a cloud deployment.

Run the following from that checkout's root, in an authorized terminal with the
key injected by a secret manager. This 1Password example contains only a reference
placeholder. Replace the reference with the intended vault/item/field; never put
the actual value in the command:

```sh
BOAT_API_KEY='op://VAULT/ITEM/FIELD' op run -- node --input-type=module <<'JS'
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  state,
  checkConfig,
  childEnv,
  cli,
} from "./scripts/worktree/config.mjs";
import { ownedRunning } from "./scripts/worktree/processes.mjs";
import { projectLock } from "./scripts/worktree/registry.mjs";
import { safe } from "./scripts/worktree/files.mjs";
import { backend, dir } from "./scripts/worktree/context.mjs";

await projectLock(async () => {
  const s = await state();
  await checkConfig(s, true);
  if (!(await ownedRunning(s)))
    throw new Error("Start this checkout's owned backend first");
  const selector = path.join(dir, "convex.env");
  await safe(selector);
  const lines = readFileSync(selector, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (
    lines.length !== 1 ||
    lines[0] !== `CONVEX_DEPLOYMENT=anonymous:${s.deployment}`
  ) {
    throw new Error(
      "Refusing a changed deployment selector or target override",
    );
  }
  const key = process.env.BOAT_API_KEY;
  if (!key || /\s/.test(key))
    throw new Error("A nonempty Boat key is required");
  const env = childEnv(s);
  delete env.BOAT_API_KEY;
  const target = ["--env-file", selector];
  const set = spawnSync(
    process.execPath,
    [cli(), "env", "set", "BOAT_API_KEY", ...target],
    {
      cwd: backend,
      env,
      input: key,
      encoding: "utf8",
      timeout: 20000,
    },
  );
  if (set.status !== 0)
    throw new Error("Backend environment update failed; output suppressed");
  const names = spawnSync(
    process.execPath,
    [cli(), "env", "list", "--names-only", ...target],
    {
      cwd: backend,
      env,
      encoding: "utf8",
      timeout: 20000,
    },
  );
  if (
    names.status !== 0 ||
    !names.stdout.split(/\r?\n/).some((name) => name.trim() === "BOAT_API_KEY")
  ) {
    throw new Error(
      "Backend environment verification failed; output suppressed",
    );
  }
  console.log(
    "BOAT_API_KEY is configured in this checkout's backend; value hidden.",
  );
});
JS
```

The managed child environment, verified anonymous selector and lifecycle lock
keep the command on the checkout's owned backend. Extra selector entries, including
cloud/authentication/self-hosted overrides, are refused. The CLI receives the value
through stdin; its output
is captured, and the verification requests names only. Keep 1Password commands
in one authorized terminal session when setting up several values.

The local Convex database stores the environment value. Restrict its state
directory to the owning account, mode `0700`. Treat ignored backend state as
sensitive; do not commit, upload or copy it into another worktree.
`worktree:stop` and teardown preserve backend state. Explicit database cleanup
removes it, and a new checkout needs its own configuration. Do not add the key to
`backend.env`, frontend `.env` files, worktree bootstrap configuration or fixtures.
Never use a `VITE_` or `NEXT_PUBLIC_` prefix for provider credentials.

Saving the variable does not enable live Boat behavior in the simulator playground.
The authenticated host guide remains an integration example rather than installed
live endpoints. The standalone Node smoke CLI also needs its own authorized secret
injection; it does not read Convex deployment variables automatically. Account and
budget approval for [live verification](live-verification.md) remain separate from
storing the key.

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
still be starting. Create acknowledgements are recorded as starting even when
the reply reports ready; an independent observation must confirm readiness.
A successful creation claim means the ID was obtained, not
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
ID in the shared operation. An initial DELETE response remains transitional even
when it reports completed; a separate matching job read confirms completion.
Pending, processing and blocked deletion remain
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
native guest permissions/isolation for that boundary.

Read/write responses may echo the absolute request path or its exact relative
spelling from Boat's documented `/home/user` work directory. For example,
`/tmp/example.txt` may be echoed as `../../tmp/example.txt`, and
`/home/user/project/example.txt` as `project/example.txt`. The adapter computes
only that one equivalent spelling from the already validated absolute request.
It does not normalize arbitrary traversal, decode paths or resolve symlinks.
Relative caller requests remain invalid. List/delete replies and listed child
paths retain their absolute identity checks. Any unrelated or noncanonical echo
fails conservatively.

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

The [offline conformance guide](conformance.md) records the baseline case matrix,
explicit cancellation skip, optional dependency boundaries and packed runtime/type
checks. These checks use synthetic native HTTP and do not imply live support.

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
