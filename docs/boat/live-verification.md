# Opt-in live verification

Boat is still qualified by offline fixtures only. The maintainer command in
`scripts/boat/live-cli.mjs` provides an opt-in live smoke run. It is never imported
by the component or example app. The admission and inventory module in
`scripts/boat/live-guard.mjs` remains offline and has no credential or SDK access.
Run the deterministic guard tests with `pnpm test:boat:live-guard` and the runner
and CLI tests with `pnpm test:boat:live`. Both are in `check:all`, using fake HTTP
and a trap for ambient network access. CI never runs a live qualification.

## Approval contract

An operator must supply explicit approval for a named disposable account before
any live provisioning. A plan must contain exactly these fields:

| Field | Accepted value |
| --- | --- |
| `version` | `1` |
| `runId` | Fresh lowercase UUID, never reuse across runs |
| `accountId` | Exact native test-account ID, 1–128 ASCII identifier characters |
| `approved` | `true`, recorded after owner approval |
| `expiresAt` | Timestamp in the next hour |
| `machineType` | `small` |
| `maxMachines` | 1 or 2 total creation intents, including forks |
| `maxSeconds` | 60–600 seconds for admitting new resources |
| `ttlSeconds` | 60–300 seconds for native auto-stop configuration |
| `budgetUsd` | Positive finite approved amount |
| `estimatedTotalUsd` | Positive finite reviewed estimate at or below the budget |
| `acknowledgeUnboundedCleanupCost` | `true` |

This module validates the recorded plan. It cannot establish who approved it,
verify provider prices, calculate the estimate, enforce a dollar cap or stop
resources. The runner authenticates through a read-only account lookup
and matches the returned native ID before calling `reserve`. Merely setting
`approved: true` is not owner authorization.

The time limit closes admission. It is not a guaranteed VM shutdown deadline.
Native auto-stop can be extended by activity, and unresolved cleanup can continue
to incur charges. The estimate must include starts and storage as well as VM time.
A live run needs a separately reviewed estimate and explicit approval of these
limits and residual charges. No live run is authorized by this document.

## Inventory protocol

Use a new inventory file in an owner-only directory, mode `0700`, outside the
checkout. `createInventory` validates the plan before creating that file
exclusively with mode `0600`. It syncs the initial file and directory. Every
transition is appended and synced before returning. A write failure closes the
inventory and requires native work to stop. Keep inventories private and never
commit or upload them as PR evidence.

1. `reserve(accountId, "create")` records an intent before the native request.
   Use the returned run-scoped intent ID as the host idempotency input. Use
   `reserve(accountId, "fork", parentId)` only for a confirmed owned parent.
2. `created(intentId, providerId)` binds a confirmed creation response. Invalid,
   duplicate or lost replies leave the intent unresolved. No further creations
   are admitted while an intent is unresolved. Do not retry the native write.
3. `deleting(providerId)` records an attempted deletion before sending it. Only
   confirmed owned IDs are accepted. A second deletion attempt is refused.
4. `deletionAccepted(providerId, jobId)` records the accepted native deletion job.
5. `nativeDeletionVerified(providerId, jobId)` records completion only after the
   caller has independently validated the native job's ID, sandbox target, kind
   and completed status. This bookkeeping call does not contact the provider.
   It records the audited deletion contract digest with the completion event.

Deletion remains available after the admission deadline. Counts never reset
when machines are deleted. A newly confirmed native deletion is recorded as
`native-deletion-completed`, covering the owned sandbox's machine, snapshots and
content records under the contract below. Legacy `deleted` events retain their
original `vm-deleted-snapshots-unverified` state. Reading an old journal does not
upgrade its proof or replay a mutation. An unknown contract digest is rejected.

## Native deletion contract

The [pinned Boat OpenAPI](https://docs.boat.dev/openapi/boat-v1.yaml), audited on
2026-11-04 with SHA-256
`9f2abcf0735ba6230fba1b40ac9a11fe9022348997152821f3b99a1f7c2421fc`,
documents `deleteSandbox` as deleting the sandbox machine, its snapshots and its
content records. The returned deletion operation must reach `completed`. Saved
snapshots and other shared artifacts are independent. Its `DeletionOperation`
schema also explains that data referenced by a later snapshot, fork or saved
snapshot can remain until those readers are deleted.

The fixed smoke sequence creates no saved snapshots, reusable templates or
external sharing links. Its only additional resource is an explicitly tracked
owned fork, deleted before the parent. The runner therefore uses the existing
sandbox-deletion jobs for native resource cleanup. It issues no extra snapshot
deletes and never sweeps account-wide artifacts. Tests assert the complete native
mutation sequence so adding an independent artifact requires revisiting this
cleanup contract.

`cleanupVerified: true` means every owned intent has a matching completed native
delete job recorded under that pinned contract, with no cleanup or inventory
failure in the run. `cleanupScope` names the sandbox machines, snapshots and
content records. It does not mean physical erasure of all shared bytes, removal
of unrelated saved artifacts, or independently verified zero billing.
`physicalDataErasureVerified` stays `false`. A changed upstream deletion contract
requires a new audit before recording equivalent proof.

After a restart, `readInventory(file)` reconstructs the recorded state without
network access or replaying mutations. Existing inventories cannot be reopened
for provisioning. A truncated or invalid inventory throws a fixed unresolved
cleanup error, without echoing its content. A pending intent without a native ID
requires provider-assisted investigation if the API has no authoritative
read-only idempotency lookup. Never find targets by names, scan-delete an account,
or treat a 404 as proof of completed deletion.

## Commands and scope

Build the current adapter with `pnpm build:lib`. Use a new private directory outside
the checkout for the plan and inventory. The inventory filename must not exist.
Create a plan using the contract above, a fresh run UUID and the actual test-account
ID. Have the owner review the size/count/time settings, total estimate, approved
budget and residual cleanup charges before recording approval.

These commands do not access credentials or contact Boat:

```sh
pnpm boat:live --check-plan /absolute/private/plan.json
pnpm boat:live --report /absolute/private/inventory.jsonl
```

Plan validation does not authorize a live run. Only after separate owner approval,
inject `BOAT_API_KEY` into an authorized child command using a secret manager and
invoke the exact run acknowledgement:

```sh
pnpm boat:live --live /absolute/private/plan.json /absolute/private/inventory.jsonl --approved-run UUID_FROM_APPROVED_PLAN
```

Never put keys in command arguments, plans, inventories, chat or logs. Ambient
credentials alone cannot enter live mode. The CLI accepts no account, organization,
URL or command override. It always selects the personal wallet, verifies `/me`'s
native account ID and checks `/limits` for start permission, zero active machines,
sufficient concurrent capacity and absence of an organization wallet ID. An absent
native account ID is a refusal. Archived account machines are not inspected or
modified; zero active machines is not proof the account has no archived machines.
Use a dedicated disposable account and do not run another workload concurrently.

The fixed sequence creates one small private machine with `noEnv: true` and native
snapshots enabled by the adapter. It checks readiness; writes, reads and lists a
run-specific file under `/tmp`; runs one finite detached `printf` command and
checks its history/logs; and reads the source-scoped template catalog. A two-machine
approval also forks the owned parent and verifies its copied file. A one-machine
approval reports the fork check skipped. It deletes the parent's fixture file,
stops and resumes the parent once, then attempts child-first VM cleanup.
The reviewed estimate must allow up to two starts for one-machine mode or three
starts for two-machine mode, including resume. It must account for storage and
unresolved charges. This runner neither quotes prices nor enforces a dollar cap.

A VM running observation is not proof that its guest file service is available.
Before the parent's first file write and the fork's file read, the runner probes
the owned machine's `/tmp` directory through the bounded read-only file API. It
retries only normalized timeout, capacity, rate-limit or unknown-outcome read
failures, within the same work deadline and at most 30 attempts. Permission and
validation errors stop immediately. This never retries a file write or another
mutation. `guestReadinessRetries` reports the number of transient reads.

Ordinary status polls have at most 30 reads each. Log retrieval has at most eight
bounded pages and retains at most 4096 bytes of the generated sentinel output in
memory. It never emits raw command output, account profiles, API error text or
keys. Native calls retain the adapter's five-second deadline and response bound.
The work deadline uses the smaller of plan expiry and `maxSeconds`. SIGINT and
SIGTERM abort the work phase. Cleanup uses a fresh signal and a separate 30-second
window, with at most ten deletion-status reads per machine. A deletion is dispatched
at most once. Status reads reconcile accepted jobs; 404s and mismatched jobs never
prove cleanup. The separate cleanup window can extend the command beyond the
work deadline and is not a provider-enforced lifetime limit.

The smoke runner calls the public factory's native adapter directly. Component
claim persistence and Convex runtime behavior are covered by the existing offline
and anonymous-backend tests; this command does not live-qualify a deployed Convex
host. Its fork bookkeeping decodes the current adapter's accepted child-ID handle
before polling readiness. A future handle-format change requires updating this
maintainer tool and its tests.

## Reports and remaining qualification

The final JSON report lists every recorded creation intent, confirmed native VM
ID, accepted deletion job and unresolved cleanup state. It projects fixed failure
stages and, when available, a validated normalized `errorCode`, rather than
retaining exceptions, provider-code strings or native bodies. If writing a confirmed
ID fails, the current process retains that ID in its final report and stops native
work when the inventory refuses subsequent transitions. A crash between receiving
a reply and recording it can still lose that reply. A lost creation reply with no
native ID is never retried or guessed from an account-wide list.

Hard termination cannot run cleanup. `--report` reconstructs the durable journal
without credentials or provider calls and cannot replay provisioning or deletion.
A malformed/truncated journal remains an unresolved operator investigation.
Keep all reports private; redact account/resource IDs before posting evidence.

Exit code `1` means refusal or failed verification. `2` means smoke checks
passed but native resource cleanup is unresolved. A live run returns `0` and
`qualification: "smoke-passed"` only when its checks and scoped native cleanup
both pass. This describes that run's approved configuration, including any
explicitly skipped fork check, rather than a provider-wide release declaration.

Read-only inspection returns `0` when its recorded native cleanup is complete or
its inventory is empty, and `2` for unresolved or legacy fixture records. It still
reports `qualification: "unverified"`, because smoke check results are not stored
in the inventory and no provider revalidation occurs. Successful plan validation
also returns `0`; it does not authorize provisioning.

Cancellation, transfers, image capture/restore, memory preservation and expiring
connections remain unsupported. The runner checks that they are absent from
capabilities and never invokes unsafe native substitutes. Actual live evidence
and explicit resolution of all unresolved native resources remain release gates. Provider-assisted read-only resolution is needed for a lost
creation reply when no authoritative idempotency lookup exists. No live run or
provider-support declaration is authorized by this document.
