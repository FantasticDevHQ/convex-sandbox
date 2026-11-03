<img src="assets/brand/logo-mark.svg" width="64" alt="Fantastic.Dev" />

# convex-sandbox

[A Fantastic.Dev Project](https://fantastic.dev)

A provider-neutral Convex component for sandbox APIs. The current experimental
baseline proves the boundary between a trusted provider adapter and component
state. Boat, E2B and Daytona adapters are separate integrations under development.
The package is private during baseline development and is not published to npm.

## Run the example

Use Node 22+ and pnpm 9.15.0.

```sh
pnpm install --frozen-lockfile
pnpm dev:frontend
```

Open the loopback URL printed by Vite. The private example is a React/Vite starter
using TanStack Router, with Overview and Integration routes. It starts without
provider credentials, a backend connection or a Convex account. It shows package
setup and the experimental boundary; it does not yet offer sandbox controls.

## Mount the component

The example consumes the workspace package through its public exports. Build the
library before deploying the host configuration:

```sh
pnpm build:lib
```

```ts
import sandbox from "@fantastic.dev/convex-sandbox/convex.config.js";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(sandbox);
export default app;
```

The core entry point exports `SandboxProviders`, `registerProvider`, shared types
and Convex validators. See the [common contract guide](docs/contracts.md) and
[registry and operation guide](docs/state.md). The
[lifecycle guide](docs/lifecycle.md) covers action-local SDK dispatch, durable
creation claims and bounded reconciliation. The [execution guide](docs/execution.md)
covers one-shot commands, asynchronous handles, cancellation and bounded output. The
[file guide](docs/files.md) covers bounded text/binary access, path policies and ephemeral transfer handles.
The [image and connection guide](docs/images.md) covers native artifact readiness and expiring access handles. The
experimental `SandboxBoundary` remains the narrow observation proof. Component types
are available from `@fantastic.dev/convex-sandbox/_generated/component.js` and
convex-test registration helpers from `@fantastic.dev/convex-sandbox/testing`.
React, TanStack Router and browser tooling are example/development dependencies;
core imports do not require them. The testing entry point needs convex-test.

## Local backend

Commit changes, then use `pnpm worktree:setup` and `pnpm worktree:start`. These use
checkout-local anonymous Convex backends and stable allocated ports. Use
`pnpm worktree:start --frontend` to include Vite on its reserved frontend port. The internal
`proof:observe` fixture invokes a simulated adapter and stores the projected
observation; `proof:latest` reads it. It is a server-only fixture, not a public API.
See [development instructions](docs/development.md) for safe lifecycle commands.

## Checks

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm test:package
pnpm test:example
```

Install Chromium with `pnpm exec playwright install chromium` before browser tests.
Browser evidence is written outside the repository by default. CI uses UbiCloud
and runs the full `pnpm check:all` command. Signed URLs, private conversations,
credentials and real customer data do not belong in committed artifacts.

Read the [architecture decision](docs/architecture/0001-adapter-boundary.md) and
[PR policy](docs/pull-request-standard.md) before contributing. External durable
storage, guest desktop management and agent runtimes are separate work.

## Provenance and license

MIT. Better Stripe at `7dfda90f0e734e94c5541738a68e0a68536b92e9` is the package-layout
reference; no Stripe business logic is included. Worktree tooling retains its
license and upstream provenance under `scripts/worktree` and in the development
guide. The official Fantastic.Dev logo is copied unchanged from the brand-kit
commit `0ce1aebc3e8418d7e59ce171e117cf9793dd2f3a`.
