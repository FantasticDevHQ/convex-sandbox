# Create an owned Boat fixture

The Machines page links to `/machines/new`. Choose a logical machine key and
explicitly select **Create approved machine**. The URL retains the selected key
as a search parameter, so reloading inspects the original operation instead of
generating a new operation identity. Keys contain 1–80 letters, digits, dots,
underscores or hyphens, begin with a letter/digit, and cannot be `new` (reserved
for the route). A logical key is not a native ID or access credential.

## Authority and dispatch

The verified [operator boundary](example-auth.md) wraps the mounted page and
both `live/create:status` and `live/create:create`. The action accepts only a
logical key. Scope comes from the server-owned grant, provider is Boat, and the
operation ID is stable: `create-` plus the logical key. Browsers cannot choose
an account, wallet, size, TTL, guest environment, provider ID or ownership scope.

Before new dispatch, the action requires the [reviewed run](example-allowance.md),
server credentials and a fresh read-only account/wallet identity check. A known
provider start prohibition refuses creation. It uses public `createHostAccess`
to authorize creation, then atomically reserves the financial admission with the
same stable intent. It awaits admission before registering the public Boat
provider and invoking `SandboxProviders.lifecycle(createLifecycleStore(...)).create`.
The shared component's creation claim owns native creation and accepted binding.
There is no direct native create path or parallel native lifecycle owner.

The provider receives the host-reviewed Small size and duration as its requested
auto-stop TTL. It creates private machines with `noEnv: true` so guest secrets
are not inherited. The TTL is a provider request, not a guaranteed shutdown or
billing cap. The underlying adapter sends a bounded stable native idempotency key;
the shared durable claim, rather than the native key's lifetime, prevents replay.

## Acceptance and readiness

A create reply obtains an identity; it is not an independent readiness check.
The Boat adapter now records accepted creation as `starting`, including when the
create reply itself says `ready`. The view displays **Pending readiness**. Use
the owned machine detail's bounded refresh to obtain a separate accepted registry
observation; a `running` observation then displays **Ready**. Creation never
polls or invents readiness automatically.

## Unknown outcomes and reload

Repeated requests for a logical key inspect its existing reservation, provision
and registry state before considering new admission. They do not invoke creation
again, including after approval expires. A failed/timed-out/malformed creation
reply remains the original component provision with `unknown` status and its
financial reservation stays counted. No new key is generated automatically.

If the action is interrupted after financial reservation but before the component
claim, its original reservation remains durable. After 30 seconds the UI treats
that unresolved intent as an unknown outcome. An expired component execution lease
is likewise displayed as unknown. Neither condition proves native non-dispatch.
Caught action-boundary failures mark the financial reservation unknown immediately.
There is no automatic resubmission, account scan, guessed native ID or reset.

The query reads only this operator scope's exact logical key from the host ledger
and public component APIs. It returns no credentials, raw provider bodies or
connection URLs. UI state subscribes reactively; the create action's response is
not used to fabricate completion. Unknown work retains the original key/operation
and points the operator toward exact-owned recovery. Recovery and cleanup must
remain available after admission expires.

## Offline verification and hosted setup

`example/convex/live/create.test.ts` executes the real consumer wrapper, shared
claims and Boat transport with deterministic synthetic replies. It checks one
POST for concurrent duplicate creation, safe guest options, pending state until
refresh, retained unknown outcome through query/retry, and authority/configuration
refusal. `example/e2e/create.spec.ts` separately renders the production panel in
a labeled offline fixture to check duplicate-click suppression, pending/observed
readiness and unknown outcome across reload. Its callback counter is synthetic;
actual adapter POST counts are asserted by the backend tests. These tests do not
qualify external auth, live Boat creation or account-wide provider behavior.

No real run plan, credentials, operator grants, native resource or hosted deployment
is configured by this implementation. Before hosted configuration, verify the
actual FantasticDev Convex team slug/ID, reuse its correct existing project and
verify the selected deployment. Local worktrees retain their isolated anonymous
backends, allocated ports and checkout-local state under the adopted lifecycle
commands. Historical unresolved native intents remain unresolved; this workflow
must never replay them or reset their journals.

The browser suite also mounts the production connected creation component with a
memory router and test-only rejecting Convex hooks. It verifies that changing the
search key does not unmount pending/error state, and invalid typed keys are refused
before navigation. The Vite test-server transform is confined to that suite; it
adds no production authentication bypass or backend test endpoint. A backend test
separately seeds an admitted-but-interrupted intent with no component claim and
verifies that inspection/retry retains the slot without dispatch.
