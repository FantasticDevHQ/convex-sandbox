# Local example backend

The `example/convex/demo.ts` API mounts the installed component and uses its public lifecycle, execution, file, image and host-access APIs. It registers the exported simulator; it does not provision a cloud VM or run a shell. The React/TanStack Router playground subscribes to those records at `/playground`. Select a fixed profile to run the walkthrough; it never calls a provider directly.

## Start and seed

Use the managed anonymous backend in [development.md](development.md): frozen install, `pnpm worktree:setup`, then `pnpm worktree:start`. No provider account, API key or cloud development deployment is required. Public demo endpoints fail closed unless the backend's built-in `CONVEX_SITE_URL` has a loopback hostname. Keep this development backend on loopback; this guard is not production authentication or protection for an exposed self-hosted server.

From the repository root, call the local CLI using only its managed environment:

```sh
(cd example && pnpm exec convex run --env-file ../.worktree/convex.env demo:seed '{}')
(cd example && pnpm exec convex run --env-file ../.worktree/convex.env demo:info '{}')
(cd example && pnpm exec convex run --env-file ../.worktree/convex.env demo:reset '{}')
```

Seed is repeatable. It creates one machine for each fixed profile: `ephemeral`, `persistent` and `memory`, plus a synthetic `/workspace/README.txt`. These profile names select simulator behavior, not real providers or separate authenticated users. Read `demo:capabilities` or `demo:info` for advertised operations. Memory stop pauses; persistent stop retains disk; ephemeral stop discards it. Unsupported operations fail explicitly.

## Reactive API and actions

Queries read actual component records: `list`, `get`, `history`, `execution` and `logs`. `files` returns metadata derived from the latest private simulator checkpoint; `info` includes fixture mode, current epoch, initialization and write lease expiry. These are normal subscribable Convex queries. An action's return value alone does not drive their state.

Actions include `lifecycle` (`start`, `stop`, `delete`), `execute`, `status`, `cancel`, `listFiles`, `readFile`, `writeFile`, `deleteFile`, `connection`, `transfer`, `snapshot` and `snapshotStatus`. Use a fresh operation ID for each new mutation and reuse it only to retrieve/reconcile that same request. Commands are a server-defined scenario enum: `hello`, `background`, `large-output`, `nonzero`, `lost-reply`, `rejected`. There is no browser-supplied shell command, provider, owner, scope or credential. File paths are restricted to `/workspace`; text writes and read pages are limited to 4 KiB. Use synthetic data only.

`lost-reply` persists the native result before hiding the start reply. The component returns `unknown`; a later `status` action reconstructs the simulator and reconciles the existing command without dispatching it again. Background progress advances on explicit status calls. Cancellation acknowledgement does not mean the command is already cancelled. Output retention allows only known synthetic fixture output. Connection and transfer responses say `mode: "simulation"`, `functional: false`; their `.invalid` handles cannot open a desktop or transfer a file. No live-provider option is offered.

## Persistence, reset and limits

The host stores one control row and at most three private simulator checkpoint rows. Every successful simulator mutation awaits its checkpoint before an injected lost reply can occur. Each action loads a fresh simulator; process memory is not its durable store. A 60-second global write lease serializes fixture actions. Epoch/token checks reject stale checkpoint writes. Concurrent writes return a capacity error; callers must make a deliberate later request. There is no background retry or scheduler. `busy` is a query-time hint; use `leaseUntil` to account for expiry when a crashed action produces no later write.

Reset changes the fixture epoch and recreates three machines. It replaces only owned checkpoint rows; it neither enumerates nor deletes external machines. Older component registry, execution and operation history remains in the local database under previous epoch scopes, hidden from current demo queries. Reset does not purge that history. Repeated resets and unique operations consume local storage; use the toolkit's explicit owned cleanup to delete the entire disposable backend when finished. Stop/restart preserves it.

Before adapting these endpoints to a deployed app, replace the local fixture identity with verified host authentication and authorization, select provider configuration on the server, and define appropriate quotas, retention and concurrency. Never expose this fixture as a production multi-user backend or accept browser API keys.

## Verification

`tests/demo.test.ts` exercises seed/reset, action boundaries, unknown reconciliation, file state, cancellation, profile capabilities, input rejection, local-only enforcement and lease fencing through the installed component. The real two-worktree qualification first runs a recorded Playwright walkthrough on the owned frontend, then runs `example/scripts/qualify-backend.mjs` in each owned checkout: WebSocket subscriptions observe actual create/stop/start changes, checkpoints survive backend restart, unknown execution reconciles, and reset leaves the sibling backend untouched. It uses synthetic data without provider credentials.

## Interactive walkthrough

Open `/playground` on the frontend URL printed by `pnpm worktree:start --frontend`. Create the three demo machines, select `persistent`, and run the hello or large-output scenario. Output is a reactive, two-chunk page; Check execution also fetches the next bounded provider log batch; use Next/Previous to inspect bounded cached output. Run lost-reply and use Check execution to reconcile the existing command. Background fixtures advance only on explicit checks and support cancellation acknowledgement separately from final state. Recent execution history lets you select recorded handles after navigation/reload.

Write and read `/workspace/note.txt`, stop/start the persistent machine, and read the retained text. Try memory stop/resume to see `paused`. Ephemeral stop discards files. Snapshot and preview metadata controls follow declared capabilities; unsupported controls are disabled with an explanation. Snapshot readiness uses an explicit check. Preview handles remain nonfunctional. Delete requires an inline confirmation and shows the retained tombstone. Reset recreates the fixtures.

Without a loopback `VITE_CONVEX_URL`, the frontend shows local setup instructions and makes no backend calls. Query errors show a retryable setup/denied view; lost connections show a reconnect message. Action errors use safe fixed explanations. Form paths and contents remain local input until an explicit action; they are never copied into URLs. The frontend is a local development demonstration, not a production authorization boundary.
