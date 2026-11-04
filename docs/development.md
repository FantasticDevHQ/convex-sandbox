# Local development

The repository uses the toolkit from
[convex-worktrees](https://github.com/FantasticDevHQ/convex-worktrees) at commit
`1c677d33372991ea4dc7269826ece2778fa07503`, installed with its Node installer.
All exported modules, configuration and tests are adopted under `scripts/worktree`.
Its license is preserved. The configured backend and frontend are `example`;
`frontendRuntime: "vite"` selects the reserved-port Vite adapter.

Commit changes before `pnpm worktree:setup`. Setup discovers and fetches origin's
live default branch, checks freshness and allocates stable backend/site ports
under a host-wide registry. It provisions an anonymous local Convex backend,
without a cloud deployment or account credentials. State is checkout-local and
ignored by Git. Start and stop use recorded process ownership rather than ports.

- `pnpm worktree:setup`: provision this clean checkout.
- `pnpm worktree:start`: run the owned local backend.
- `pnpm worktree:stop`: stop it and preserve state/port reservations.
- `pnpm worktree:teardown`: stop it and release reservations, preserving data.
- `pnpm worktree:cleanup --yes`: delete only owned disposable state explicitly.
- `pnpm worktree:prune`: remove eligible stale reservations.

The toolkit uses Node-only lifecycle commands. This application adds a Vite
adapter while retaining the upstream Next default for generic toolkit fixtures.
Run `pnpm worktree:start --frontend` to supervise both services on reserved ports.
Stop an existing backend-only supervisor before requesting a frontend.

On a constrained host, serialize installs, tests, codegen and backend integration
with the shared heavy-job lock, set `NODE_OPTIONS=--max-old-space-size=512`, and use
one worker. Run the full check:all command on actual UbiCloud CI.

## Package and frontend workflow

The library publishes ESM entry points from `dist`: core, component configuration,
generated component types and optional testing utilities. `pnpm build:lib` builds
these before example type checking or backend setup. The lifecycle setup now executes
`prepareCommand` before the first backend push; preparation failures stop setup. Keep the package private
until the release ticket verifies the packed artifact and registry settings.
The example has an explicit workspace dependency and uses public package exports.

`pnpm dev:frontend` builds the library and starts Vite on an available loopback
port. A standalone frontend has no provider credentials or backend identity; `/playground` shows setup until a loopback backend is configured.
TanStack Router handles `/`, `/integration`, `/playground` and `/playground/$profile`.
No router plugin/code generator is needed for these code-defined routes.

`pnpm test:example` uses Playwright with an in-process Vite server on an OS-assigned
port. It closes the server on teardown, including test failures. Tests cover
navigation, reload, browser back, offline setup and a narrow viewport. The real-backend qualification also runs the interactive walkthrough on its owned frontend. Their screenshots/video
are temporary artifacts, not repository documentation. `CSB_PLAYWRIGHT_OUTPUT`
selects a local output directory; CI uses the runner's temporary directory.

The official brand logo is retained unchanged. Formatting excludes generated
bindings, upstream toolkit source and the logo asset to preserve provenance.

## Two-worktree qualification

From a clean committed checkout, run `pnpm test:worktree:integration`. This is a
real-backend test, not a provider test. It requires network access for origin and
initial dependencies/backend binaries, but no cloud development account or keys.
CI includes it in check:all on UbiCloud and fetches full Git history.

The adopted integration test discovers and fetches the selected origin base via
the toolkit's existing freshness adapter. It creates two disposable detached
checkouts at that immutable commit, applies the tested commit's tracked delta,
and commits that delta only inside the disposable checkouts. It refuses a dirty
source or a candidate not based on the freshly fetched base. No local environment,
database, untracked source or user credentials are copied.

Each checkout installs frozen dependencies and runs the actual component and Vite
frontend. The local Convex CLI invokes the mounted observations component with
synthetic values under identical logical keys. The local-only public example also
uses synthetic data and private simulator checkpoints, as described in
[example-backend.md](example-backend.md). Qualification checks distinct credentials without
printing them, six reserved ports, isolated component rows, stable restart,
frontend availability, teardown/reacquisition, busy-port refusal and cleanup that
leaves the sibling running. It also persists distinct registry references and
execution outcomes under the same logical/operation keys in each backend, then
checks that an unknown execution and its active reservation survive restart.
Cross-scope registry reads return null. An internal host action also exercises
the lifecycle store bridge and action runtime with synthetic create, stop and
delete adapters on both backends. A second internal action uses the execution
bridge for one-shot dispatch, bounded logs and cancellation/completion separation.
Its cached handle and output are checked after restart. These install no public
test endpoint or shell service.

Cleanup uses owned lifecycle operations with `--yes` before removing only the
created disposable checkouts. If ownership validation or shutdown fails, the
checkout is preserved for inspection. The harness does not kill by port or name.

### Toolkit adaptations

The recorded upstream remains `1c677d33372991ea4dc7269826ece2778fa07503`.
All exported modules and tests are retained. Application-specific changes are:

- `frontend.mjs` and its tests select Vite with loopback binding and strict ports.
- `prepare.mjs` and its tests execute a configured argv array without a shell.
- Lifecycle/configuration helpers build the package before push and bind Vite to
  the owned local backend rather than an inherited cloud URL.
- Process supervision validates the frontend CLI/port before starting services
  and waits for its owned frontend listener during startup/shutdown.
- The upstream integration harness uses existing component CLI operations and
  fresh-base candidate checkouts instead of requiring public probe functions.

Keep these adaptations separate from upstream ownership, locking, cleanup and
freshness modules. Reconcile them when updating the toolkit; a source link alone
is not adoption. Real qualification results belong in PR evidence, not this guide.

## Lint and generated bindings

`pnpm lint` runs Biome's recommended rules with warnings treated as failures.
It checks package and example source, tests and the codegen entry point. Generated
bindings and the adopted toolkit are excluded. Biome parses TypeScript directly,
so lint does not depend on a compiler-plugin compatibility range. Formatting
remains a separate Prettier concern.

After `pnpm worktree:setup` and `pnpm worktree:start`, run `pnpm codegen` to
regenerate bindings. The command validates the checkout's local backend identity,
removes inherited Convex cloud configuration and pins its validated anonymous
deployment. Empty cloud selectors prevent dotenv files from overriding that choice.
It explicitly generates `src/component` from TypeScript, rebuilds the package,
then generates the consuming example. App codegen alone skips the package's
published JavaScript component and cannot validate its source bindings.

Commit regenerated files, then run `pnpm codegen:check` to regenerate and reject
modified, deleted, staged or new binding files. The command writes generated
files while checking. The full `pnpm check:all` runs this check inside the first
disposable qualification checkout, so CI needs no cloud account or copied keys.
Do not run codegen against an unmanaged deployment to satisfy this check.

## Package and walkthrough qualification

`pnpm test:package` packs the current built package and installs that tarball into an owned temporary consumer, outside the workspace. It first bootstraps the consumer with the source checkout's pinned Convex version and a fresh temporary registry metadata cache. It then removes only that consumer's node_modules and performs a frozen offline reinstall before verifying public exports without convex-test. Both installations disable scripts and automatic peers. A frozen source install alone does not guarantee pnpm has the registry metadata needed to resolve a new consumer. It also checks that private source paths are not exported and that the archive contains only the intended distribution/documents. The temporary consumer and archive are removed on completion or failure. Run `pnpm build:lib` before this standalone check; check:all already builds it. This does not publish a package or certify a registry release.

The real browser walkthrough blocks non-loopback HTTP requests. It reloads while a command is unknown, selects its persisted history entry, and reconciles it; it also renders a rejected command and recovers with a new scenario. Unit checks count native simulator executions across lost reply, reconciliation and replay, and verify that reset epoch scopes cannot access prior commands, output or files through the public demo API. Existing host authorization checks cover foreign scope/provider identities before SDK dispatch.

Initial frozen dependency installation, origin freshness checks and the first backend binary download still need network access. The browser and synthetic provider need no external service or provider credentials. CI retains browser artifacts outside the repository; PR media is uploaded through GitHub attachments.

## Checked documentation samples

`pnpm test:docs` extracts TypeScript fences from the quickstart and adapter guide. Each fence names its intended `convex/` or `src/` location. The checker compiles all samples against built public package exports, actual generated example bindings and installed dependencies. Temporary source/config files stay outside the checkout and are removed on success/failure. A negative fixture verifies that an unavailable export fails compilation. This checks the marked samples only; it does not claim that every conceptual snippet in the focused reference guides is a complete application.

`pnpm test:boat:live-guard` tests the offline admission and durable resource inventory
for a future opt-in Boat live runner. It performs no provider calls and is included
in `check:all`. See [live verification preparation](boat/live-verification.md) for
approval limits, unresolved cleanup reporting and the remaining live runner work.
