<img src="assets/brand/logo-mark.svg" width="64" alt="Fantastic.Dev" />

# convex-sandbox

[A Fantastic.Dev Project](https://fantastic.dev)

A provider-neutral Convex component for sandbox lifecycle, command execution,
files and native images. Trusted host adapters call provider APIs; the component
persists registry, operation and execution state for reactive queries and explicit
recovery. It does not run an agent loop or choose a consumer's machine topology.

The `0.1.0-rc.0` baseline candidate is experimental, remains private and is
**not published to npm**. See [candidate preparation](docs/releasing.md). Boat, E2B and Daytona are separate [planned integrations](docs/integrations.md).
The playground uses a simulated provider: no real VM, shell or compute runs.
An [experimental Boat entry](docs/boat/setup.md) supports safe `create` and
`describe` through shared claims and server-owned configuration. Other Boat
operations and live qualification remain pending.

## Run the playground

Use Node 22+ and pnpm 9.15.0 from a clean checkout:

```sh
git clone https://github.com/FantasticDevHQ/convex-sandbox.git
cd convex-sandbox
pnpm install --frozen-lockfile
pnpm worktree:setup
pnpm worktree:start --frontend
```

Open the printed frontend URL and choose Playground. Create demo machines and
explore command output, unknown-outcome reconciliation, files, stop/pause/resume,
snapshots and deletion. The React/Vite example uses TanStack Router. It needs no
provider credentials, cloud development deployment or login. Initial dependency
and local backend provisioning needs network access.

For a frontend without a backend, use `pnpm dev:frontend`; Playground shows setup
instructions. Stop with `pnpm worktree:stop` to preserve data. See the
[walkthrough](docs/example-backend.md) and [worktree lifecycle](docs/development.md)
for restart, teardown and explicit owned cleanup.

## Integrate with a Convex app

Start with the [checked quickstart](docs/quickstart.md): build/pack a local tarball,
install it into your app, mount `convex.config.js`, authenticate host queries and
subscribe through the generated app API. Use only public exports. Registry
installation commands will be added when a release is verified.

The [adapter guide](docs/adapters.md) shows server-owned SDK registration,
capabilities, optional Node-only modules, credentials and conformance. The
[API map](docs/api.md) links exact clients, store bridges, validators and semantics.
Host wrappers must verify identity, membership/resource permissions and file
policies. Installing the component does not authenticate public endpoints.

| Read next | Purpose |
| --- | --- |
| [Contracts](docs/contracts.md) / [State](docs/state.md) | Identity, capabilities, resources, generations and operation ordering |
| [Lifecycle](docs/lifecycle.md) / [Execution](docs/execution.md) | Creation claims, stop/resume, unknown outcomes, cancellation and bounded logs |
| [Files](docs/files.md) / [Images](docs/images.md) | Path policies, native transfers, snapshot readiness and expiring connections |
| [Security](docs/security.md) / [Testing](docs/testing.md) | Host authorization, safe output/errors, simulator and adapter conformance |
| [Integration roadmap](docs/integrations.md) | Separate provider, external storage, desktop and runtime work |

Stop is not delete; disk persistence is not memory preservation. Unknown command
outcomes are reconciled without automatic redispatch. Native image support does
not promise cross-provider portability. Bounded history/output is not a retention
SLA. See each operation guide before adapting provider behavior.

Core imports need no React or test runner. The testing entry exports a simulator
and conformance kit without a runtime test dependency; component registration/test
store helpers and their declarations use the optional convex-test peer. Backend
security helpers live in the server-only subpath.

## Contribute and verify

```sh
pnpm typecheck
pnpm test
pnpm test:docs
pnpm build
pnpm test:package
pnpm test:example
```

Install Chromium with `pnpm exec playwright install chromium` before browser tests.
Run focused checks serially with the shared host lock on constrained machines.
UbiCloud runs full `pnpm check:all`, including checked documentation samples,
packed-package consumption, browser flows and two real anonymous backends. Test
media/logs stay outside the repository and evidence belongs on the PR.

Read [development](docs/development.md), the [architecture decision](docs/architecture/0001-adapter-boundary.md)
and [PR standard](docs/pull-request-standard.md). No provider SDK, external bucket,
custom desktop, scheduler or agent runtime is bundled by the baseline.

## Provenance and license

MIT. Better Stripe at `7dfda90f0e734e94c5541738a68e0a68536b92e9` is the package-layout
reference; no Stripe business logic is included. Worktree tooling retains its
license and upstream provenance under `scripts/worktree` and in the development
guide. The official Fantastic.Dev logo is copied unchanged from brand-kit commit
`0ce1aebc3e8418d7e59ce171e117cf9793dd2f3a`.
