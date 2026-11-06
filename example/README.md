# Component workbench

[A Fantastic.Dev Project](https://fantastic.dev)

<img src="../assets/brand/logo-mark.svg" width="64" alt="Fantastic.Dev" />

A private React/Vite example with TanStack Router. Run `pnpm dev:frontend` from the
repository root after a frozen install. The library builds first. Vite chooses an
available loopback port and prints its URL. `/` is the overview; `/integration`
shows the host mount. The persistent sidebar also links to Setup, Machines, Commands,
Files, Forks, Operations and Cleanup. These live workflow pages explain their
unavailable state until their consumer backends are implemented. Machine detail
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
