# Run the example and retain recovery records

The simulator works without provider keys. Boat workflows use real application
wrappers, but require verified operator access, server configuration and separate
live approval. Reading this guide, checking setup or signing in grants no spending
authority. The live qualification gate still depends on CSB-31 and CSB-32 and
resolution of the prior unknown native fork. No production deployment, credential
change, new budget or package publication is authorized here.

## Fresh simulator

Use Node 22+ and pnpm 9.15.0. In a clean committed checkout, run from the repository
root. If T3 already bound a worktree, keep using that checkout.

<!-- checked-simulator-commands -->
```sh
pnpm install --frozen-lockfile
pnpm worktree:setup
pnpm worktree:start --frontend
```
<!-- /checked-simulator-commands -->

Setup fetches the live origin base and provisions an independent anonymous backend
with checkout-local state and allocated cloud/site ports. Start supplies both
reserved backend ports and prints the frontend URL. No Convex account, cloud dev
deployment, provider key or another checkout's environment is needed. Do not run
an unmanaged `convex dev`, choose a personal cloud project, or copy local backend
state to make setup pass.

1. Open the printed frontend URL and choose **Simulator**. The route is `/playground`.
2. Click **Create demo machines**, then open **persistent**.
3. Keep **Hello / completed** selected in Command scenario and click **Run fixture**. The output
   is `Hello from convex-sandbox.` followed by a newline.
4. Write a short note at `/workspace/note.txt`, clear its editor, and read it back.
5. Select **Lost reply / unknown outcome**, run it, reload the page, open its retained unknown
   execution and choose **Check execution**. Inspection retains the original ID.
6. Stop and resume the persistent fixture, then read the same file. Memory-profile
   stop pauses; ephemeral-profile stop discards its disk. These are simulator
   behaviors, not claims about a native VM.
7. Use `pnpm worktree:stop`, then `pnpm worktree:start --frontend` to reopen the same
   local state. Stop preserves data; teardown releases reservations and preserves
   data. The [lifecycle guide](development.md) explains explicit local cleanup.

The simulator's Reset replaces only its loopback fixture namespace. It is not Boat
cleanup or permission to erase native recovery journals. Use it only for disposable
simulator data. On a fresh anonymous backend, `/playground` initially shows
**No demo machines yet**. A frontend-only `pnpm dev:frontend` preview can render
routes but does not itself provision the backend.

## Configure a trusted host only when authorized

Continue to use the managed anonymous backend for worktree development. The
[authentication guide](example-auth.md) describes an existing Clerk development
instance, a Convex-verified JWT and exact issuer/subject grants. There is no
editable persona fallback. Signing out immediately hides private results.

| Configuration | Location | Meaning |
| --- | --- | --- |
| Managed local Convex URL | Supplied by worktree frontend lifecycle | This checkout's allocated backend, never a copied cloud URL |
| `VITE_CLERK_PUBLISHABLE_KEY` | Frontend, development publishable key only | Existing `pk_test_` instance; not a secret key |
| `CLERK_JWT_ISSUER_DOMAIN` | Exact owned backend | Existing HTTPS Clerk development issuer with JWT audience `convex` |
| `EXAMPLE_OPERATOR_GRANTS` | Exact owned backend | Verified issuer/subject and stable host-chosen scope; the host adds `example-boat:` |
| `BOAT_API_KEY` | Exact owned backend, server-only | Inject through the separately approved secret workflow; never `VITE_*`, URLs or checked-in files |
| `BOAT_ORG` | Exact owned backend | Explicit reviewed wallet; absence means `personal`, not Boat's active wallet |
| `EXAMPLE_LIVE_RUN_PLAN` | Exact owned backend, after plan review | Immutable finite account/wallet/size/count/start/time/dollar proposal |

Use the managed `.worktree/convex.env` target when configuring an owned local
backend; never select an ambient cloud deployment. Do not print environment values
or put literal secrets in command history, screenshots or PR text. This guide
shows names and shapes only; it installs no grant, key or plan.

### Hosted FantasticDev ownership

Before any separately authorized hosted configuration, obtain authenticated
Convex metadata and record the actual team slug and ID, project name/ID and
selected deployment name/type. Confirm ownership belongs to FantasticDev and
reuse its correct existing project when present. A display name or guessed slug
is insufficient; do not select a personal or unrelated team.

| Identity | Current verified value |
| --- | --- |
| FantasticDev team slug and ID | Unverified |
| Existing hosted project and ID | Unverified |
| Selected hosted deployment and type | Unverified |

Keep these unverified until checked; do not fill them from assumptions. Redact
credentials from verification evidence. Hosted checks do not authorize production
deployment or provisioning. Local development remains anonymous and isolated.

### Checked server-only readiness example

This illustrative action uses this app's existing verified operator helper and
public read-only Boat export. Copy it with the authentication helpers and generated
app bindings, not into a browser module. The mounted UI already uses
`live/setup:readiness`; this example creates no parallel lifecycle owner.

```ts convex/example-server-setup.ts
import { action } from "./_generated/server.js";
import { v } from "convex/values";
import { readBoatSetup } from "@fantastic.dev/convex-sandbox/boat";
import { requireOperator } from "./live/operator.js";

export const inspectServerSetup = action({
  args: {},
  returns: v.object({
    state: v.union(v.literal("checked"), v.literal("unavailable")),
    accountId: v.union(v.string(), v.null()),
  }),
  handler: async (ctx) => {
    await requireOperator(ctx);
    const apiKey = process.env.BOAT_API_KEY;
    if (!apiKey) return { state: "unavailable" as const, accountId: null };
    try {
      const readiness = await readBoatSetup({
        apiKey,
        org: process.env.BOAT_ORG ?? "personal",
      });
      return { state: "checked" as const, accountId: readiness.accountId };
    } catch {
      return { state: "unavailable" as const, accountId: null };
    }
  },
});
```

The key is read on the server, accepted in no browser argument and returned in no
DTO. The public helper projects safe account facts and rejects credential echoes.
Failures return a fixed state, not raw provider text. A readiness check reads only
account/limits; it does not approve spending or create a machine.

## Operator walkthrough after separate approval

Do not begin while a prior native intent or cumulative allowance is unresolved.
The original fork conflict has no confirmed child ID; zero active machines does
not rule out a stopped child. Preserve its original records. Do not replay it,
guess IDs, reset private journals, scan-delete resources or send support messages
as part of this guide.

Before any new live run, the owner must separately approve the exact account,
wallet/team, Small size, machine count, starts, duration, estimate, dollar allowance
and residual-charge risk. Review current pricing separately. The app's admission
ledger is not a provider-enforced billing cap or automatic shutdown guarantee.
Follow the [plan schema and limits](example-allowance.md), including at most two
machines, four starts, two concurrent reservations and 60 minutes. The plan must
cover the chosen walkthrough; do not rotate run IDs or increase limits on failure.

1. Open **Boat → Setup**. Verify the signed-in operator and exact account/wallet
   readiness. Unknown availability stays unknown. A failed check stays a Boat
   failure, with no simulator fallback.
2. Open **Review a bounded live run**. Compare the complete proposal with the
   owner's separate approval, acknowledge residual charges and approve only that
   exact snapshot. No machine is created by approval.
3. Open **Machines → Create an approved test machine**, choose a new stable logical key, and submit once.
   Keep its URL and operation ID. Creation remains pending until an independent
   machine observation establishes readiness. An unknown outcome is not a retry
   instruction. See [creation](example-create.md).
4. Open the owned machine details and **Refresh observation**. Inspect original
   binding/generation and measurements; absent measurements remain Unknown. The
   app never scans account inventory to infer ownership.
5. In **Commands**, run the reviewed argv command. For a simple output check use
   `/usr/bin/printf` with one argument per line: `%s\n`, then `hello sandbox`.
   Inspect its original history ID and exit code, then read bounded output. Reload
   retains the execution and shared log cursor. PID-based cancellation is unsupported.
6. Prepare `/home/user/demo` through the reviewed `/usr/bin/mkdir` argv command
   with `-p` and `/home/user/demo`, if needed. In **Files**, save a direct child
   filename, then read back exact bytes. Inline edits are UTF-8, at most 64 KiB.
   The lexical policy is not a symlink jail; use a trusted directory.
7. In details, **Prepare retained home fixture**, then **Stop owned machine**.
   Inspect the original job until stop is confirmed. `/home/user` is retained;
   `/tmp` is not a persistence target. Running forks may omit recent writes, so
   stop/reconcile before fork.
8. In **Forks**, choose a distinct new child key and review the additional machine
   admission. Submit the original stopped-source fork once, inspect its retained
   result and **Verify retained copy** only after child readiness. An accepted
   child ID and successful copy verification are distinct facts.
9. If included in the reviewed start budget, resume the original source and
   inspect until **Bytes verified**. RAM/process continuity is not promised.
   Source creation, fork and source resume consume three starts in this sequence.
10. Read the source-scoped catalog in details. Pending/saving is not ready.
    Desktop/SSH, snapshot capture/restore and transfers remain unsupported where
    the capability declaration says so. Developer views show the checked source
    without executing it.
11. Follow exact-owned recovery and cleanup below. A failed action, expiry or
    successful terminal command does not settle every resource intent.

## Recover and clean up

Open `/operations?machine=<original-key>` and retain original operation URLs,
native IDs and generations. Page reads and reloads do not issue replacement
mutations. Explicit supported inspection performs bounded native reads. Historical
bindings remain visible but cannot update a replacement. Missing native handles
stay unresolved; use the original Forks flow to bind a confirmed child and verify
its copy. Machine lifecycle checks finish concurrency release and home-byte proof.

In **Cleanup**, type the exact retained run ID. Request one recorded deletion,
child first, then inspect the original deletion job separately. Parent cleanup
waits for the child. A 404, accepted DELETE, empty active-machine list or pending
job is not confirmed deletion. Unrelated machines and replacement generations
receive no cleanup authority. Record every owned intent as confirmed or explicitly
unresolved; native completion is not physical erasure or measured zero billing.

**Documented reset check:** while any child or deletion is unknown/pending, try
selecting **Reset run view**. The UI must keep it disabled and the original records
visible. The server also rejects a direct reset attempt. Keep the original keys,
operation IDs, binding generations and allowance journal for later inspection.
Do not bypass the guard or remove local data to make cleanup appear complete.

After all targets have matching deletion proof or confirmed non-dispatch failure,
all resume intents are terminal, and 24 hours pass after the later of run expiry or
latest terminal proof, **Refresh retained cleanup review**. Reset then archives
only the completed view; it does not erase ownership/component records or reset
cumulative allowance. See [exact deletion](example-delete.md) and
[run-ledger rules](example-allowance.md).

Simulator Reset, native run-view archival and `pnpm worktree:cleanup --yes` are
three different actions. The last deletes only owned local backend data, not native
resources. Do not use it while that data holds unresolved native recovery records.
Stop preserves data; teardown releases ports and preserves data for recovery.

## Troubleshoot without widening authority

| Symptom | Check |
| --- | --- |
| Setup/freshness refuses to run | Preserve dirty files and commits; resolve base divergence deliberately. Do not reset or silently stash. |
| Simulator shows setup or cannot connect | Use this checkout's printed loopback URL, managed backend and allocated ports. Do not copy another `.env.local`. |
| Live access is locked | Check the existing development issuer, JWT audience and exact server-owned issuer/subject grant. Do not add a demo persona. |
| Readiness is unavailable | Check server key presence, explicit wallet and account state. Do not print credentials or replace unknown facts with guesses. |
| Admission is refused | Inspect expiry, duration, immutable proposal and retained counters. Reapproval cannot replenish allowance. |
| An operation is unknown | Keep the original intent. Use supported read-only reconciliation; do not replay mutations to discover the outcome. |
| File request is unconfirmed | Inspect the original path and byte bound, directory existence and generation. Never auto-retry a write/delete. |
| Cleanup stays unresolved | Retain every original record, resolve active operations and confirm matching native jobs. An account sweep is not recovery. |

## What the checks establish

`pnpm test:docs` compiles this server example and the displayed public client
modules. Offline browser tests assert native failure messages, denied access,
network traps and guarded reset using synthetic HTTP and test authority.
The full UbiCloud gate follows the managed fresh simulator lifecycle on two
anonymous backends, opens the actual playground, and verifies restart/isolation.
Independent review checks these execution results against this guide.

Those checks do not certify an external Clerk login, a hosted FantasticDev
selection or an approved live Boat UI run. Keep live qualification under its
separate prerequisites and approval, and keep PR evidence out of product docs.
