# Reviewed run approval and admission

Boat mode links Setup to **Review a bounded live run** (`/setup/run`). The
verified operator boundary protects this route, its reactive proposal query and
its approval action. Project planning, setup readiness and simulator activity
create no spending authority. The application starts with no proposed run.

## Host-reviewed proposal

Only after the account owner has reviewed a finite test plan, configure
`EXAMPLE_LIVE_RUN_PLAN` on the intended backend with these exact fields:

| Field | Meaning |
| --- | --- |
| `runId` | Stable identifier for this reviewed run; never rotate it to evade limits |
| `scope` | Exact server-derived `example-boat:` operator namespace |
| `accountId` | Reviewed Boat account ID returned by read-only setup |
| `wallet`, `walletTeamId` | Exact server-selected `BOAT_ORG` selector and verified wallet team ID; personal uses `personal` and null |
| `size` | `small` only |
| `expiresAt` | Absolute Unix milliseconds; approval must expire within 24 hours |
| `maxMachines` | Positive integer, at most 2 newly created/forked machines |
| `maxStarts` | Positive integer, at most 4 starts, at least `maxMachines` |
| `maxConcurrent` | Positive integer, at most 2 and at most `maxMachines` |
| `durationMinutes` | Positive integer, at most 60 minutes from approval |
| `estimateUsd` | Positive owner-reviewed total estimate for maximum starts and duration |
| `allowanceUsd` | Positive allowance at least the estimate, at most 100 USD |

These policy maxima bound the example's proposal, not provider charges. The UI
shows the actual reviewed estimate and allowance, not an invented price quote.
The owner must verify current pricing and residual costs separately before
configuring a plan. The estimate includes the reviewed maximum starts and their
duration; each admission reserves an equal share, rounded upward to a millionth
of a dollar. It is an admission estimate rather than a meter of actual spending.

The browser cannot supply a scope, account, wallet or replacement limits. It
receives a canonical review token for the exact proposal. Its checkbox and
**Approve reviewed run** button call an authenticated action with that token and
an explicit risk acknowledgment. The action verifies the selected account and
wallet with the public Boat read-only setup client before an internal mutation
records approval. A changed proposal, mismatched account, missing credentials,
expired plan or missing operator authority refuses approval. Credentials and
provider errors remain server-only. No machine is created by approval.

Hosted Convex setup must first verify the actual FantasticDev team slug/ID,
reuse the correct existing project and verify its selected deployment. This
feature selects no hosted project or deployment. Local worktrees continue to
use the adopted managed anonymous backend with checkout-local state and ports;
never copy another checkout's credentials or backend state.

## Durable host guard

`liveApprovals` and `liveReservations` are host-owned admission records, separate
from the component's authoritative native lifecycle. Each scope has one immutable
approval ledger. Reapproving the same snapshot returns its existing ID; a different
snapshot cannot replace it or zero its counters. There is no public reservation,
release, reset or native-ID binding endpoint.

Trusted host actions must call the internal `live/allowance:reserve` mutation
before billable dispatch. They supply a stable run ID, intent key, logical machine
key and operation kind (`create`, `fork`, `start`) after their workflow-specific
ownership checks. Creation/fork consumes a machine and start, while a start
consumes a start. Every admission consumes a concurrent reservation and its
estimated dollar share. The mutation reads and writes the same approval document
transactionally, so racing admissions cannot both claim the final slot.

The earlier absolute expiry or duration deadline closes new admission. Missing or
expired approval, changed host configuration and exhausted machine/start/concurrent
or estimated-dollar allowances refuse admission. The caller must await a successful
reservation before invoking the shared component lifecycle client. The [owned creation workflow](example-create.md) uses this guard before dispatch.
It adds no parallel native lifecycle implementation or direct provider mutation.

An intent key binds to its original operation kind and logical key. A repeated
request returns `admitted: false` and the original reservation, including after
expiry. It never licenses redispatch. The caller must inspect/reconcile the original
component operation instead. `markUnknown` retains a lost-reply reservation without
reducing any counter. Reload, process restart, expiry and retries do not release
slots or restore cumulative allowance.

The owned stop/resume workflow now provides an internal exact-proof release of
concurrency after a successful shared stop. See [lifecycle verification](example-lifecycle.md).
It preserves cumulative machine/start/dollar usage, and cannot release an unknown
creation with no confirmed child. No public release/reset endpoint exists.
Neither a lost response nor an empty active-machine list proves deletion. Never
reset a private journal, guess an unknown child ID or scan-delete account resources.

## Residual charges and verification

The approval view explains that this is **not a provider-enforced billing cap**.
Cleanup failure, stopped resources and unknown creation outcomes can incur
additional charges beyond the estimate, allowance or expiry. Admission deadlines
are not automatic shutdown guarantees. Exact-owned cleanup remains necessary;
cleanup and recovery must remain possible after admission expires.

`example/convex/live/allowance.test.ts` uses synthetic verified identities and
injected read-only account responses. It checks expiry before a dispatch spy,
transactional concurrent limits, retained unknown reservations, account/proposal
mismatch and retry/reset refusal. `example/e2e/allowance.spec.ts` exercises the
production review panel in an explicitly synthetic offline fixture, including
cost/risk disclosure, explicit acknowledgment, expiry and failed verification.
The mounted `/setup/run` route uses reactive Convex state under operator access.
These checks grant no actual live approval and do not qualify a live Boat run.
