# Local development

The repository uses the toolkit from
[convex-worktrees](https://github.com/FantasticDevHQ/convex-worktrees) at commit
`1c677d33372991ea4dc7269826ece2778fa07503`, installed with its Node installer.
All exported modules, configuration and tests are adopted under `scripts/worktree`.
Its license is preserved. The configured backend is `example`; the toolkit does not yet launch the
frontend. Use `pnpm dev:frontend` for the Vite/TanStack Router starter.

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

The inherited toolkit uses Node-only commands. Its optional frontend adapter is
Next-specific; adapt it for Vite in the example-app ticket rather than pretending
it already launches that UI. Two-worktree application qualification remains CSB-3.

On a constrained host, serialize installs, tests, codegen and backend integration
with the shared heavy-job lock, set `NODE_OPTIONS=--max-old-space-size=512`, and use
one worker. Run the full check:all command on actual UbiCloud CI.

## Package and frontend workflow

The library publishes ESM entry points from `dist`: core, component configuration,
generated component types and optional testing utilities. `pnpm build:lib` builds
these before example type checking or backend setup. Keep the package private
until the release ticket verifies the packed artifact and registry settings.
The example has an explicit workspace dependency and uses public package exports.

`pnpm dev:frontend` builds the library and starts Vite on an available loopback
port. This starter is static and has no provider credentials or backend identity.
TanStack Router handles `/` and `/integration`; the full playground is later work.
No router plugin/code generator is needed for these code-defined routes.

`pnpm test:example` uses Playwright with an in-process Vite server on an OS-assigned
port. It closes the server on teardown, including test failures. Tests cover
navigation, reload, browser back and a narrow viewport. Their screenshots/video
are temporary artifacts, not repository documentation. `CSB_PLAYWRIGHT_OUTPUT`
selects a local output directory; CI uses the runner's temporary directory.

The official brand logo is retained unchanged. Formatting excludes generated
bindings, upstream toolkit source and the logo asset to preserve provenance.
