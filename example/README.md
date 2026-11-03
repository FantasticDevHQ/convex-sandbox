# Component workbench

[A Fantastic.Dev Project](https://fantastic.dev)

<img src="../assets/brand/logo-mark.svg" width="64" alt="Fantastic.Dev" />

A private React/Vite starter with TanStack Router. Run `pnpm dev:frontend` from the
repository root after a frozen install. The library builds first. Vite chooses an
available loopback port and prints its URL. `/` is the overview; `/integration`
shows the host mount. Refresh and back navigation work on both routes.

The UI starter is still static. The local Convex backend now mounts the component
and exposes reactive queries and fixed actions backed by durable simulator state.
It provisions no real machines and needs no provider keys. See the
[backend guide](../docs/example-backend.md) for seed/reset, API behavior, limits
and restart verification, and [development](../docs/development.md) for the
managed anonymous backend.

Browser tests start and close their own Vite server on an OS-assigned loopback
port, use one worker and require no keys. Screenshots and video live outside the
repository. Set `CSB_PLAYWRIGHT_OUTPUT` to choose an evidence directory.
