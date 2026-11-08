# Component workbench

[A Fantastic.Dev Project](https://fantastic.dev)

<img src="../assets/brand/logo-mark.svg" width="64" alt="Fantastic.Dev" />

A React/Vite consumer of convex-sandbox with TanStack Router. Explore durable
machine, command and file workflows in the credential-free simulator, or inspect
the mounted Boat workflows behind verified operator access and finite approval.
The example uses public package exports and shared component clients.

## Start the simulator

Use Node 22 or newer and pnpm 9.15.0. From a clean, committed checkout:

```sh
pnpm install --frozen-lockfile
pnpm worktree:setup
pnpm worktree:start --frontend
```

Stay in your existing T3/editor worktree when one is already bound. Setup fetches
the configured/default origin base and allocates this checkout's anonymous Convex
backend, data directory and stable ports. It needs no account login, cloud dev
deployment, provider key or copied environment. Do not substitute `convex dev` or
another checkout's configuration for the managed commands.

Open the printed frontend URL, then **Simulator** or `/playground`. Click
**Create demo machines**, open **persistent**, and run the hello fixture. No real
VM or shell is involved. The [checked walkthrough](../docs/example-walkthrough.md)
covers files, lost replies, stop/resume, restart and cleanup.

`pnpm worktree:stop` preserves local state and reservations.
`pnpm worktree:teardown` also releases ports while preserving data. Keep recovery
records for unresolved native work; deleting local data does not delete a Boat
machine. See [development lifecycle](../docs/development.md).

For a frontend-only layout preview, `pnpm dev:frontend` prints a temporary
loopback URL. Interactive simulator workflows still require the managed backend.

## Choose a mode

| View | Purpose | Authority |
| --- | --- | --- |
| Simulator `/playground` | Durable local fixtures and synthetic outcomes | No provider credentials or native resources |
| Boat `/setup` and workflow routes | Real consumer wrappers and scoped bindings | Convex-verified Clerk development identity, server policy and separate approval |
| Integration `/integration` | Copy checked host source beside its workflow | Static public source; opening it executes no provider operation |

A failed Boat request remains a Boat failure. There is no simulator fallback or
browser persona that grants live authority. The [Boat host guide](../docs/boat/guide.md)
is checked documentation; the mounted consumer wrappers live in `convex/live`.

## Use the workflows

Start with the [operator walkthrough](../docs/example-walkthrough.md#operator-walkthrough-after-separate-approval).
It is a checklist for a later separately approved run, not approval to configure
credentials, select a hosted deployment or provision resources.

| Workflow | Route and guide |
| --- | --- |
| Operator access and readiness | `/setup`: [identity](../docs/example-auth.md), [server setup](../docs/example-setup.md) |
| Finite approval | `/setup/run`: [run plan and admission ledger](../docs/example-allowance.md) |
| Create and inspect owned bindings | `/machines/new`, `/machines/$machineId`: [creation](../docs/example-create.md), [reactive state](../docs/example-machines.md) |
| Stop, resume and delete | Machine details: [retained home bytes](../docs/example-lifecycle.md), [matching deletion job](../docs/example-delete.md) |
| Detached commands and logs | `/commands`: [execution](../docs/example-commands.md), [bounded output](../docs/example-logs.md) |
| Bounded home files | `/files`: [path and byte limits](../docs/example-files.md) |
| Fork and verify copy | `/forks`: [stopped-source workflow](../docs/example-fork.md) |
| Templates and limits | Machine details: [source catalog](../docs/example-catalog.md) |
| Recovery and cleanup | `/operations`, `/cleanup`: [original IDs and guarded reset](../docs/example-walkthrough.md#recover-and-clean-up) |
| Checked developer views | `/integration` and optional workflow panels: exact source, copy and workflow links |

Hosted Convex projects/databases must belong to **FantasticDev**. Verify the
actual team slug/ID, project identity and selected deployment from authenticated
metadata; reuse the correct existing project. No hosted selection is currently
verified. Local worktrees remain isolated anonymous backends. See the
[ownership requirement](../docs/development.md#hosted-convex-ownership).

## Develop and verify

Run focused checks with one worker, a bounded heap and the shared host lock.
`pnpm test:docs` compiles documentation and all six displayed host modules against
public exports. `pnpm test:example` runs offline browser checks with no ambient
provider/auth/deployment credentials. Media stays outside the repository.

The cross-workflow browser harness uses production panels and actual app/component
functions in convex-test, with explicit synthetic authority and fatal HTTP/WS
traps. It does not verify a hosted login or real provider. The
[qualification boundaries](../docs/development.md#offline-browser-boundary) matter
when reporting results.

`pnpm test:package` also builds a fresh app against a copied tarball, without
component workspace source or local backend state. It reuses declared third-party
cache packages; it is not a fresh registry-install claim. The adopted two-worktree
integration verifies actual anonymous backend identity, ports, app journals,
restart and teardown. Run full `pnpm check:all` on UbiCloud and verify the actual
runner identity. See [packed app qualification](../docs/development.md#packed-application-qualification).

Live UI qualification remains a separate release gate requiring resolved prior
unknown intents and a new exact approval. Neither offline checks nor this guide
settle the historical unknown fork, authorize provisioning or permit publication.
