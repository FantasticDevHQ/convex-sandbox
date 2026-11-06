# Owned machine observations

Boat mode's Machines page lists only component bindings authorized by the
server-owned [operator policy](example-auth.md). It does not list or scan Boat's
native account inventory. A fresh workspace stays empty until an approved
consumer workflow establishes owned bindings. No public seed, arbitrary native
ID binding or create endpoint is added by the browser implementation.

`live/machines:list` accepts standard pagination options, with at most 50 rows
requested per component page; the UI requests 20 at a time. Scope comes from the
verified operator and the host's `example-boat:` namespace. The public
`createHostAccess` boundary projects only authorized Boat records and filters
other provider bindings. A cursor cannot supply identity or tenant authority.
The displayed count is loaded records, not an account-wide inventory total.

Detail URLs contain a logical key. `live/machines:get` resolves that key only
inside the authorized scope and returns no data for an absent or alternate
provider binding. The URL grants no access. The cached list/detail queries read
component state and never construct a Boat client or read its API key.

## Manual bounded refresh

The detail's Refresh observation button invokes `live/machines:refresh` with
only the logical key. It resolves and authorizes the current component binding
before reading `BOAT_API_KEY` and the host-selected `BOAT_ORG`. It registers the
public Boat provider in the trusted action and invokes the shared
`SandboxProviders.lifecycle(createLifecycleStore(...)).refresh(...)` path.
There is no parallel lifecycle owner or direct browser provider request.

Each request performs one bounded describe of the exact bound native ID. No
native account list, provisioning, stop/resume or deletion is performed. Shared
registry sequence and generation fences decide which observation is accepted.
Afterward the action reauthorizes and projects the current accepted registry
record. An in-flight response for a previous binding cannot overwrite a rebind.
No scheduled refresh is introduced by this workflow.

The detail subscribes to the component query; it does not fabricate a new state
from button acceptance or a cached action return. Failed native reads retain the
last accepted observation and display a failed-refresh label. Missing credentials
are explicit errors. Missing CPU, memory or disk measurements show Unknown,
without inferring them from machine size. A retained deletion tombstone disables
refresh. An interrupted pending refresh can be recovered with a new bounded read.

Private views remain under the operator session boundary and unmount on sign-out.
None of these reads approves a billable run. Hosted Convex ownership still must
be verified against the actual FantasticDev team slug/ID, existing project and
selected deployment before hosted configuration; local worktrees remain isolated
anonymous backends.

## Deterministic checks

`example/convex/live/machines.test.ts` calls the mounted endpoints through Convex
Test with synthetic verified identities and injected provider responses. It checks
scope filtering, authority-argument rejection, alternate providers, accepted state
changes, native failures, credential refusal and rebind fencing. It makes no live
Boat request.

`example/e2e/machines.spec.ts` renders the production detail panel in an explicitly
synthetic Vite fixture. It checks unknown measurements and reactive prop updates
from refresh, including failure that retains the accepted state. The real route
uses Convex reactive queries under the existing authenticated boundary. These
checks do not qualify external Clerk authentication or an existing Boat machine.
