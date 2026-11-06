# Example operator access

The simulator stays available without keys at `/playground`. Live workflow
pages require a Convex-verified Clerk development identity and an explicit
server-owned operator grant. A simulator profile never grants live authority.
No authentication account, hosted deployment or Boat resource is created by
installing or opening the example.

## Development configuration

The example uses the [official Convex Clerk integration](https://docs.convex.dev/auth/clerk)
with `@clerk/react` and `ConvexProviderWithClerk`. Use an existing Clerk development
instance with its Convex integration enabled and JWT audience `convex`. The app
accepts development publishable keys beginning with `pk_test_`; its auth
configuration accepts an exact HTTPS `*.clerk.accounts.dev` issuer origin.
Production authentication configuration is outside this example's current scope.

Before configuring a hosted Convex project/database, verify that it belongs to
FantasticDev using the actual team slug/ID, project identity and selected
deployment. Reuse the correct existing project. Do not select a personal or
unrelated team. No hosted selection has been verified by this implementation.
Local worktrees continue to use independent anonymous backends through the
[managed lifecycle](development.md). Never copy another checkout's configuration.

When separately authorized to configure an existing development instance:

1. Commit the checkout, then run `pnpm worktree:setup` and
   `pnpm worktree:start --frontend`. Use this checkout's allocated URLs.
2. Set only `VITE_CLERK_PUBLISHABLE_KEY` in the frontend's ignored local
   environment. The managed frontend supplies the checkout-local Convex URL.
   Never put a Clerk secret key, Boat API key or operator policy in `VITE_*`.
3. On that exact owned local backend, configure `CLERK_JWT_ISSUER_DOMAIN` with
   the development issuer origin. With no issuer, `auth.config.ts` registers no
   providers and the simulator still runs. Push changed auth configuration
   through the managed lifecycle.
4. Configure `EXAMPLE_OPERATOR_GRANTS` on the same backend as a JSON array.
   Each grant has exactly `issuer`, `subject` and `scope` strings. Use the verified
   Clerk user ID for subject and a stable host-chosen tenant namespace for scope.
   Read the issuer/subject from the trusted identity provider, never from an
   editable browser profile, email address or supplied action argument.

For illustration only, the policy shape is:

```json
[
  {
    "issuer": "https://your-development-instance.clerk.accounts.dev",
    "subject": "your-verified-clerk-user-id",
    "scope": "example:your-operator-namespace"
  }
]
```

This is a schema example, not an installed grant. Missing, malformed, duplicate
issuer/subject entries or invalid policy fields deny all operator access. The
policy supports at most 100 grants, and each string is bounded to 256 characters.
Operator policy and issuer settings are server environment configuration, not
browser build variables. The response returns only the caller's resolved scope
and identity, never the policy or provider credentials.

## Access and sign-out behavior

Open Setup and sign in through Clerk. Convex validates the JWT before the app
queries the operator session. An authenticated user without a matching issuer
and subject grant sees a denied state. Every live action must call
`requireOperator` before reading private bindings or invoking provider clients;
`live/access:checkAccess` is the mounted read-only action demonstrating that gate.
It accepts no caller-supplied identity, scope, account or provider ID.

Signing out unmounts private descendants immediately, before waiting for Clerk.
A failed sign-out keeps private views hidden and offers retry. A new identity
gets a fresh private subtree; a cached session for a different subject is never
used to authorize it. The public simulator uses a separate Convex client/cache.

Authentication grants no spending approval. Setup now mounts authenticated configuration and read-only account/limits checks.
Other live workflow pages remain unavailable until their consumer implementations land. No create, delete or
other provider mutation is exposed by this ticket.

## Verification and troubleshooting

`example/convex/live/auth.test.ts` exercises the mounted action and session query
with Convex Test's synthetic verified identities. Browser tests exercise the real
private-content boundary with synthetic session state in a test-only entry,
including sign-out failure, plus the actual app's missing-configuration view.
These deterministic checks require no Clerk testing token or Boat credentials.
They do not certify an external Clerk login, its JWT issuance or a live Boat run.

For an authorized identity-provider integration check, use the configured
existing development instance and verify sign-in, server grant denial and
sign-out against the owned backend. Do not use production keys for tests.
If identity verification never completes, check that the frontend publishable
key, backend issuer and `convex` JWT audience refer to the same development
instance. If Convex verifies the identity but the app denies access, check the
server-owned grant's exact issuer and subject. Do not loosen the gate or enable
a demo-persona fallback to repair configuration.
