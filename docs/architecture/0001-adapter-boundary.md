# Adapter boundary

Status: experimental decision and executable proof for CSB-1.

The host action registers provider adapters and calls their APIs. The component
owns serializable state and transactional mutations. Provider objects, SDKs,
credentials and JavaScript callbacks never cross the component RPC boundary.
The caller must authenticate and authorize before selecting a trusted scope.

## Package layout

Use Better Stripe at commit `7dfda90f0e734e94c5541738a68e0a68536b92e9` as the
[structural reference](https://github.com/FantasticDevHQ/better-stripe/tree/7dfda90f0e734e94c5541738a68e0a68536b92e9).
It separates `src/client`, `src/component`, `src/react`, `src/testing` and a private
`example` workspace. We retain the client/component/testing separation. React
helpers and the Vite playground are follow-up tickets, rather than mandatory
core dependencies. Stripe-specific workflows, dependencies and evidence assets
are not copied. This repository is a pnpm workspace, not a Turborepo.

- `src/client`: action-local adapter dispatch and projection to common values.
- `src/component`: schema, transactional observation writes and reactive queries.
- `src/testing`: offline component registration helpers, added as tests require.
- `example/convex`: minimal host mount and internal simulated invocation.
- `tests`: behavior and cross-component boundary verification.

## Invocation

1. A host action authenticates and authorizes its caller.
2. Trusted server configuration selects an adapter and supplies its credentials.
3. The action-local client calls the adapter, which may use fetch or its SDK.
4. The client validates and projects the result to explicit common fields.
5. A host-local callback invokes `ctx.runMutation(components.sandbox... , value)`.
6. Application queries call the component query to observe recorded state.

The callback is ordinary TypeScript in the same action. Only its argument is sent
to Convex. Do not store or serialize callbacks, adapter instances or credentials.
Do not turn a client-supplied provider URL or provider ID into trusted configuration.

## Configuration and credentials

Construct adapters in host actions from server-owned configuration. Core does not
require a master credential for every optional provider, or bake one provider's
environment names into its schema. Node-only SDKs belong in host action modules
with `"use node"`; core and fetch-compatible adapters remain V8-compatible.
Components cannot replace host authorization. Opaque scopes impose no account,
bot or machine topology. Public host wrappers must resolve scope from trusted auth.
The proof uses an internal synthetic fixture, not a public unauthenticated API.

## Limits of this proof

The observation path is deliberately narrow: running/stopped is only a test of the
boundary. This is not a complete lifecycle, registry, concurrency, retention or
recovery model. CSB-5 through CSB-13 implement those contracts and guarantees.
The example app, packaging and worktree qualification have separate acceptance.
A successful observation is not evidence of an actual VM or a live provider.

Provider integrations remain separate:

- Boat provider integration.
- E2B provider integration.
- Daytona provider integration.

External durable storage, agent runtimes and custom desktop sessions are outside
this component baseline. No snapshot portability or exactly-once effects are
promised. The provider integration projects must challenge this provisional
contract before it becomes a stable public API.
