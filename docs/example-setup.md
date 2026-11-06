# Read-only example setup

Open Setup after following [operator authentication](example-auth.md). Only
verified, authorized operators can read server configuration or request Boat
readiness. Signing in or checking setup never approves a billable run.

The configuration query reports whether `BOAT_API_KEY` is present and names it
when missing. The value stays in server environment configuration. `BOAT_ORG`
selects the wallet; absence explicitly selects `personal`, independent of Boat's
active-wallet setting. A malformed selector leaves readiness unavailable.
Configure these only on the exact owned backend when authorized. Never put
provider credentials or wallet authority in a browser build variable or request.

## What a readiness check reads

`live/setup:readiness` authenticates and authorizes the operator, then calls the
public server-only `readBoatSetup` export from
`@fantastic.dev/convex-sandbox/boat`. That helper reuses the adapter's existing
bounded, non-retrying transport and pinned SDK. It issues only `GET /me` and
`GET /limits`, with the host-selected `org` and `X-Boat-Org`. It does not create
or change resources, switch the active wallet, register webhooks or inspect
account-wide machine inventory.

The response contains only the account ID, selected wallet, organization wallet
ID when applicable, reported start availability and active/capacity counts.
Unreported counts or start availability stay `null` and render as unknown. A
reported suspended or closed account cannot report starts available. Email,
display names, billing details, provider messages and credentials are omitted.
Credentials echoed in an otherwise allowed identity field are rejected too.
An organization-wallet response without its actual team ID, or a personal-wallet
response claiming an organization wallet, is not accepted as a completed check.

Each check is a point-in-time read, displayed with its local check time. Provider
start availability is not operator approval or an assurance that create will
succeed. The UI contains no create button. Missing keys cause no provider call;
failed checks show a fixed retry message and no invented account facts. An
operator authorization failure also prevents provider requests. Private results
are descendants of the session access boundary and unmount on sign-out.

## Local and hosted Convex

Worktree development continues through the managed lifecycle with isolated
anonymous backends. The setup view does not select or configure a hosted Convex
project. Any future hosted example database must belong to FantasticDev. Verify
its actual team slug/ID, existing project and selected deployment from
authenticated metadata before configuring access. A display name or a typed
team string is not verification. Reuse the correct existing project; never select
a personal or unrelated team. Hosted identity remains unverified in this work.

No production deployment, credential change, live provisioning or provider
qualification is authorized by a successful setup check.

## Deterministic verification

`example/convex/live/setup.test.ts` calls the mounted query/action with synthetic
verified identities and injected HTTP responses. It asserts the native GET-only
request log, missing-key refusal, secret projection and authorization boundaries.
`example/e2e/setup.spec.ts` exercises the actual production setup panel with
explicitly synthetic operator/provider state in a test-only Vite entry.
The normal app route additionally preserves the real operator access gate.
These checks make no live Boat request and do not qualify real credentials,
external Clerk login or a selected hosted Convex deployment.
