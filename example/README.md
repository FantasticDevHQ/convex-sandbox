# Component workbench

[A Fantastic.Dev Project](https://fantastic.dev)

<img src="../assets/brand/logo-mark.svg" width="64" alt="Fantastic.Dev" />

A private React/Vite example with TanStack Router. Run `pnpm dev:frontend` from the
repository root after a frozen install. The library builds first. Vite chooses an
available loopback port and prints its URL. `/` is the overview; `/integration`
shows the host mount. The persistent sidebar also links to Setup, Machines, Commands,
Files, Forks, Operations and Cleanup. Setup checks authenticated server configuration and read-only Boat readiness.
Machines browses owned component state; the remaining live workflow pages explain
their unavailable state until their consumer backends are implemented. Machine detail
URLs use `/machines/$machineId`; a URL alone grants no resource access.
Refresh and back navigation preserve routes, and a menu exposes navigation on mobile.

The `/playground` route subscribes to the local component and exposes fixed
actions backed by durable simulator state. Select one of three profiles to explore
lifecycle, bounded output, unknown outcomes, files and snapshot readiness.
It provisions no real machines and needs no provider keys. See the
[backend guide](../docs/example-backend.md) for seed/reset, API behavior, limits
and restart verification, and [development](../docs/development.md) for the
managed anonymous backend.

Browser tests start and close their own Vite server on an OS-assigned loopback
port, use one worker and require no keys. Screenshots and video live outside the
repository. Set `CSB_PLAYWRIGHT_OUTPUT` to choose an evidence directory.

The [Boat host guide](../docs/boat/guide.md) contains an authenticated read-only
consumer backend sample. It is checked documentation, not a mounted live endpoint
or provider switch in this workbench. The playground remains explicitly simulated
with missing or ambient Boat configuration and never reads a provider key.

Hosted Convex projects/databases for this example must belong to FantasticDev.
Verify the actual team slug/ID, existing project and selected deployment before
hosted configuration; do not select a personal or unrelated team. See
[hosted ownership](../docs/development.md#hosted-convex-ownership). Local worktrees
continue to use isolated anonymous backends. This requirement does not authorize
production deployment or Boat provisioning.

Live workflow pages now have an operator access gate using Clerk development
identities verified by Convex and an explicit server-owned issuer/subject policy.
See [operator setup](../docs/example-auth.md). Missing configuration leaves live
access locked while the simulator remains available. Signing in grants no
provisioning approval.

The [read-only setup guide](../docs/example-setup.md) explains configuration
presence, explicit wallet selection and the account/limits check. Checking setup
never approves spending or provisions a machine.

The header offers explicit Simulator and Boat modes. Simulator opens `/playground`;
Boat opens `/setup` and stays labeled Boat on its workflow routes, including when
credentials or operator access are missing. Reload and back navigation keep the
route's mode. A failed Boat check stays a visible Boat failure and never supplies
simulator data. Ambient Boat configuration cannot turn simulator actions into
native requests. Host-resolved Boat scopes use `example-boat:` and cannot collide
with simulator fixture namespaces.

Machines now browses authorized component bindings with reactive details and a
manual bounded refresh through the public shared lifecycle client. It never
scans the native account. Unknown resource measurements remain Unknown. See the
[owned-machine guide](../docs/example-machines.md) for access, pagination,
refresh-failure and rebind behavior.

Review a finite live-run proposal at `/setup/run` after operator setup. It starts
without a spending plan. See [run approval and durable admission](../docs/example-allowance.md)
for the host-reviewed fields, account verification, residual-charge notice and
reservation rules. Planning and readiness checks do not approve billable work.

Create an approved Small fixture from `/machines/new`. The selected logical key
survives reload; creation stays pending until independently observed, and unknown
replies retain their original operation. See [owned creation](../docs/example-create.md)
for shared claims, private/no-inherited-secret defaults and recovery boundaries.

Owned details support [stop/resume and retained-home-byte verification](../docs/example-lifecycle.md).
Stop acceptance remains unfinished until shared job reconciliation; resume consumes
another approved start and verifies original bytes only after readiness. Exact
stop proof releases concurrency without resetting cumulative allowance.

The owned detail page also supports [exact-owned deletion](../docs/example-delete.md):
type the current logical key, retain the original job, and confirm completion only
from its separate matching status read. A 404 or accepted DELETE stays unresolved.

Commands now supports [detached execution on an owned machine](../docs/example-commands.md).
The original operation and native history identity survive reload. Inspection
shows native exit codes and never replays a lost start. Cancellation remains
unsupported.

Retained Commands views include [bounded stdout/stderr output](../docs/example-logs.md).
Explicit reads resume the shared native cursor, replace the reactive cache snapshot
without duplicate bytes, and show truncation. Drained output does not prove exit.

Files now supports [bounded owned home-file management](../docs/example-files.md):
prepare a trusted `/home/user/demo` directory, save and verify UTF-8 bytes, read
back bounded files, and confirm exact nonrecursive deletion. Its lexical policy
does not provide a symlink jail. Transfer URLs remain unsupported.

Forks now supports the [stopped-source copy walkthrough](../docs/example-fork.md).
It requires a confirmed stop, retains an accepted child under its own authorized
binding before readiness, verifies original home bytes, and keeps lost replies
unresolved without replaying the fork. No live qualification is implied.

Owned details now include the [source template catalog and capability limits](../docs/example-catalog.md).
An explicit read shows source-only mutable saved names, pending readiness and
partial lists. Unsupported capture, restore, desktop/SSH and transfers explain
their limits without requesting connections or provisioning.

### Retained operation recovery

Open `/operations?machine=<original-key>` to read retained component history and
allowance intents in the verified operator scope. An optional `operation` query
parameter reopens an exact retained ID even outside the loaded history page.
Records from older generations remain visible as history with inspection disabled.
The page never invokes a replacement create, fork, start, stop, delete or command.
An explicit inspection uses shared clients for bounded native reads against the
original ID. Missing native handles remain unresolved. Reopening an unbound child
also links its retained fork source; no account inventory is scanned.

History is paginated, not an exhaustive account audit. Allowance intents show at
most 20 per kind and disclose truncation. Inspecting a stop here does not release
allowance or verify resume fixture bytes; finish those checks in the machine
workflow. Fork binding and copy verification remain in the original Forks flow.
Creation without a confirmed identity has no supported Boat recovery lookup.

The restart qualification uses a real owned anonymous backend with synthetic
Boat identities and the production recovery panel through a test-only Node RPC
bridge. It proves component persistence and UI reopening across managed restart.
It does not prove hosted authentication, provider availability or a live outcome.
The bridge stays in Playwright fixtures; no admin credentials enter the browser.

### Exact-owned run cleanup

`/cleanup` loads the verified operator's retained run approval and its bounded
admission journal. It derives native IDs from successful original creation
records or registered fork-child proofs, never account inventory or names.
Unbound children remain unresolved and block parent cleanup. Request one recorded
deletion at a time, child first, after typing the run ID. Inspect the original
native job separately; an accepted DELETE or a missing machine is not completion.
Replaced generations receive no mutation. Active operations must be reconciled
in their original workflow before deletion.

Reset archives the completed run view only. It requires every recorded target to
have matching native deletion proof or confirmed non-dispatch creation failure,
every resume intent to be terminal, and a 24-hour retention period after the later
of run expiry or latest terminal proof. Refresh the retained cleanup review after
retention ends. Ownership journals, component records, fixtures and cumulative
allowance counters remain intact. Reset grants no new spending approval and does
not enable another run on the existing immutable approval ledger.

A full journal beyond the bounded review blocks cleanup rather than treating a
partial view as complete. Native cleanup completion is distinct from physical
erasure, provider-wide qualification, or measured zero billing. The original
historical unknown fork remains unresolved; this implementation neither replays
it nor scans or deletes account resources to infer its outcome.

### Checked developer views

`/integration` selects Files, Lifecycle, Command logs, Forks, Templates and limits,
or component mounting. Each optional developer view shows the exact checked-in
host module as inert text, with copy and workflow links. The matching view is also
available beside Files, Commands, Forks and machine workflows without changing
operator authorization. Opening source never executes a provider operation.

Copy host modules with their relative helpers and generated bindings. Keep their
verified operator scope, original binding checks, finite approval and shared
client ownership when adapting them. They are not standalone unauthenticated
endpoints. Credentials stay in server configuration; displayed environment names
are references, not secret values.

`pnpm test:docs` compiles every displayed source against public package exports
and rejects common credential patterns, hardcoded credential assignments and
private package imports. The source manifest and inert raw imports are checked
together, and browser tests compare the displayed and copied bytes with the
actual module. This static regression check supplements source review; it does
not inspect environment values or prove live provider qualification.

### Offline mounted-workflow qualification

`pnpm test:example` runs without ambient Boat, hosted auth or deployment secrets.
Playwright's setup removes credential-bearing environment variables in the test
process. The cross-workflow test supplies only explicit synthetic server policy
and an inert placeholder key, required by the real wrapper constructor. It never
uses a real Boat credential or falls back to ambient HTTP.

`example/e2e/workflows.spec.ts` mounts production panels against actual application
functions and the registered public component in `convex-test`, through a test-only
Node bridge. The scenario covers approval, creation/readiness, bounded files,
commands and cached logs across reload, recovery, catalog, stop/resume home-byte
verification, fork copy and child-first cleanup. The bridge, synthetic identity and
transport remain under `e2e`; none is a production authentication path.

Every native HTTP method/path must match the synthetic fixture. Unknown paths or
IDs remain fatal even if a client normalizes the thrown error. Browser HTTP and
WebSocket traffic is trapped outside the exact loopback Vite origin; service
workers are blocked. Negative controls demonstrate both guards fail. A real
synthetic HTTP failure is asserted through the production file panel, and loading,
missing configuration, anonymous and denied access stay locked.

This verifies the mounted functions/component protocol and production panels
without real provider or hosted identity traffic. It does not claim a real Convex
daemon, authenticated hosted route or live Boat qualification. Anonymous backend
and packed-artifact checks remain separate integration gates.
