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

## Hosted Convex ownership

Any hosted Convex project/database used by the example must belong to the
FantasticDev team. Before configuring hosted access, verify the actual team
slug and ID, project identity and selected deployment from authenticated Convex
metadata. Reuse the correct existing project when present. A display name alone
is not verification; do not choose a personal or unrelated team.

Record the verified non-secret identities and deployment type in setup evidence.
Until that check runs, hosted ownership and deployment selection remain
unverified. This repository currently documents no verified hosted selection.
Do not copy hosted credentials or deployment state into local worktrees. Local
development continues through the isolated anonymous lifecycle above.

This ownership requirement authorizes no production deployment, credential
changes or Boat provisioning. A hosted configuration check does not approve
billable provider operations.

## Package and frontend workflow

The library publishes ESM entry points from `dist`: core, component configuration,
generated component types and optional testing utilities. `pnpm build:lib` builds
these before example type checking or backend setup. The lifecycle setup now executes
`prepareCommand` before the first backend push; preparation failures stop setup. Keep the package private
until the release ticket verifies the packed artifact and registry settings.
The example has an explicit workspace dependency and uses public package exports.

`pnpm dev:frontend` builds the library and starts Vite on an available loopback
port. A standalone frontend has no provider credentials or backend identity; `/playground` shows setup until a loopback backend is configured.
TanStack Router provides persistent navigation for Overview, Setup, Machines, Commands,
Files, Forks, Operations, Cleanup, Integration and the existing Playground.
`/machines/$machineId` retains its detail URL across reloads. Workflow routes without
a mounted live host show explicit unavailable states; visiting a URL never establishes
resource ownership. The navigation collapses behind a menu on narrow viewports.
The simulator remains at `/playground` and `/playground/$profile`.
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
for the opt-in Boat live runner. It performs no provider calls and is included
in `check:all`. See [opt-in live verification](boat/live-verification.md) for
approval limits, unresolved cleanup reporting and the remaining live qualification work. `pnpm test:boat:live` exercises the
actual adapter through synthetic HTTP responses and tests CLI refusal paths; it
never contacts Boat.

## Operations recovery qualification

The live Operations route reads persisted component operations and scoped host
allowance intents without native requests on mount or reload. Explicit inspection
uses only shared lifecycle reconciliation, execution status or image status.
Original native identity, generation and sequence fences protect replacement
bindings, including when an old reply arrives after a rebind. Unsupported or
missing handles stay unresolved. A retained intent is not proof of native success
or absence. Recovery never replays its mutation or resets the admission journal.

`example/convex/live/recovery.test.ts` verifies scope, bounded reads, no replay,
and late-response generation fencing with deterministic synthetic transport.
`example/e2e/recovery.spec.ts` includes a real managed backend restart case run
inside UbiCloud's worktree integration. A Node-only test bridge reads the owned
anonymous component records into the production panel before and after stop/start.
No hosted credentials or real Boat mutations are involved. Normal UI tests skip
the restart case unless `CSB_RECOVERY_ROOT` identifies the managed test checkout.

## Cleanup and retention

The Cleanup route is a consumer of the shared exact-binding deletion workflow.
Its target list comes only from the selected scoped approval's admission records,
successful creation proofs and registered fork-child identities. It never lists
provider inventory. Pending or unknown children block parent deletion. Every
request reuses the original generation's deletion review token, so a new binding
cannot inherit cleanup authority. Each click dispatches at most one deletion or
performs at most one bounded original-job inspection.

The reset mutation only writes a scoped `liveCleanupArchives` presentation marker.
It never deletes recovery evidence, resets private journals or replenishes
cumulative allowance. It requires complete native proofs, terminal resume intents
and 24 hours after the later of run expiry or latest terminal proof. The server
rechecks these conditions transactionally; a disabled button is not its authority.
The explicit review refresh reruns the cached status query for time-based retention.

Tests use deterministic synthetic transport. Browser fixtures mount the production
panel and capture guarded reset and pending deletion, while the actual unconfigured
route demonstrates the operator gate. These are not evidence of live Boat deletion,
hosted authentication, physical erasure or zero billing.

## Displayed consumer examples

The integration manifest is `example/shared/integration-examples.json`.
`example/src/integration-examples.ts` imports only those host modules through
Vite's inert raw-text mechanism. Never import executable server modules into the
frontend to render examples. The developer panel belongs outside the gated live
subtree because it contains only public checked-in source, never query results,
configuration values or operator data.

`tests/boat/example-docs.test.mjs` is included in `pnpm test:docs`. It compiles
all displayed modules with the existing public-export documentation checker,
checks manifest/raw-import coverage, rejects common secret-shaped values and
literal credential assignments, and verifies that unavailable exports fail.
Relative helpers and app bindings resolve to this example's actual checked code.
It is a static regression guard plus independent source review, not a universal
secret detector. Browser qualification verifies exact displayed/copy bytes,
workflow links, reload selection and narrow layout. No sample executes on opening.

## Offline browser boundary

The browser test global setup scrubs ambient provider/auth/deployment secrets in
its own process. The offline Vite server also disables environment-file loading;
a synthetic `.env.local` regression verifies those values stay absent. It does not
modify checkout environment files, credential stores
or parent-shell settings. The mounted-workflow harness asserts secrets are absent
before adding an explicit placeholder key, synthetic operator grant and finite
synthetic run plan. These values authorize only the in-memory test fixture.

The Node bridge invokes real host functions in `convex-test` and registers the
public sandbox component. Its HTTP transport has an exhaustive method/path table
for exact synthetic identities, no ambient-fetch fallback, and a violation ledger
that teardown must check. Browser traffic outside the exact Vite origin is
aborted and recorded, including WebSockets. Service workers are blocked so they
cannot bypass routing. The network negative controls intentionally assert that
such violations fail the normal clean-ledger checks.

Run `pnpm --filter convex-sandbox-example exec playwright test workflows.spec.ts`
under the host lock for the focused scenario, and `pnpm test:example` for browser
regressions. The full UbiCloud gate also runs the independent actual anonymous
backend restart/isolation qualification. Do not describe the in-memory bridge as
hosted authentication or a live provider session. Never add its synthetic grants,
transport or authority controls to production entry points.

## Packed application qualification

`tests/boat/example-package.test.mjs` assembles a fresh consumer using only copied
app source and a validated extracted component tarball. It excludes component
workspace `src`, local configuration and backend state. Public entry resolution,
strict typechecking and a production Vite build run against that physical package.
A missing-export negative control must fail instead of finding workspace source.
Third-party dependency/tool symlinks point only to installed cache packages;
this is a build qualification, not a claim of a fresh registry installation.

Packing/extraction is shared with the existing anonymous-runtime packed host in
`scripts/release/pack.mjs`. Every archive entry passes the existing artifact
allowlist before extraction. The package remains private and unpublished.

The `app isolation` subtest in the adopted two-worktree integration verifies
actual host `liveApprovals` and `liveReservations` data, beyond component machine
state. `appIsolationProof` is internal-only, restricted to a fixed synthetic
namespace outside the operator scope mapper, and rejects run replacement. It
creates no native machine or provider authority. After managed restart, alpha's
run remains alpha's and beta retains its distinct run. No lifecycle ownership,
production credentials or backend state are copied between checkouts.

Review the full CI job's actual runner name, ID and UbiCloud labels before merging.
A configured runner label alone is not execution evidence. Packed/anonymous app
qualification does not settle the historical unknown native fork, provider-wide
qualification, hosted FantasticDev ownership or authorization to publish.
