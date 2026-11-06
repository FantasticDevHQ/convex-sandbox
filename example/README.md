# Component workbench

[A Fantastic.Dev Project](https://fantastic.dev)

<img src="../assets/brand/logo-mark.svg" width="64" alt="Fantastic.Dev" />

A private React/Vite example with TanStack Router. Run `pnpm dev:frontend` from the
repository root after a frozen install. The library builds first. Vite chooses an
available loopback port and prints its URL. `/` is the overview; `/integration`
shows the host mount. The persistent sidebar also links to Setup, Machines, Commands,
Files, Forks, Operations and Cleanup. Setup checks authenticated server configuration and read-only Boat readiness.
Machines browses owned component state; the remaining live workflow pages explain
their unavailable state until their consumer backends are implemented. Machine detail
URLs use `/machines/$machineId`; a URL alone grants no resource access.
Refresh and back navigation preserve routes, and a menu exposes navigation on mobile.

The `/playground` route subscribes to the local component and exposes fixed
actions backed by durable simulator state. Select one of three profiles to explore
lifecycle, bounded output, unknown outcomes, files and snapshot readiness.
It provisions no real machines and needs no provider keys. See the
[backend guide](../docs/example-backend.md) for seed/reset, API behavior, limits
and restart verification, and [development](../docs/development.md) for the
managed anonymous backend.

Browser tests start and close their own Vite server on an OS-assigned loopback
port, use one worker and require no keys. Screenshots and video live outside the
repository. Set `CSB_PLAYWRIGHT_OUTPUT` to choose an evidence directory.

The [Boat host guide](../docs/boat/guide.md) contains an authenticated read-only
consumer backend sample. It is checked documentation, not a mounted live endpoint
or provider switch in this workbench. The playground remains explicitly simulated
with missing or ambient Boat configuration and never reads a provider key.

Hosted Convex projects/databases for this example must belong to FantasticDev.
Verify the actual team slug/ID, existing project and selected deployment before
hosted configuration; do not select a personal or unrelated team. See
[hosted ownership](../docs/development.md#hosted-convex-ownership). Local worktrees
continue to use isolated anonymous backends. This requirement does not authorize
production deployment or Boat provisioning.

Live workflow pages now have an operator access gate using Clerk development
identities verified by Convex and an explicit server-owned issuer/subject policy.
See [operator setup](../docs/example-auth.md). Missing configuration leaves live
access locked while the simulator remains available. Signing in grants no
provisioning approval.

The [read-only setup guide](../docs/example-setup.md) explains configuration
presence, explicit wallet selection and the account/limits check. Checking setup
never approves spending or provisions a machine.

The header offers explicit Simulator and Boat modes. Simulator opens `/playground`;
Boat opens `/setup` and stays labeled Boat on its workflow routes, including when
credentials or operator access are missing. Reload and back navigation keep the
route's mode. A failed Boat check stays a visible Boat failure and never supplies
simulator data. Ambient Boat configuration cannot turn simulator actions into
native requests. Host-resolved Boat scopes use `example-boat:` and cannot collide
with simulator fixture namespaces.

Machines now browses authorized component bindings with reactive details and a
manual bounded refresh through the public shared lifecycle client. It never
scans the native account. Unknown resource measurements remain Unknown. See the
[owned-machine guide](../docs/example-machines.md) for access, pagination,
refresh-failure and rebind behavior.
