# Live verification preparation

Boat is still qualified by offline fixtures only. `scripts/boat/live-guard.mjs`
provides the admission and inventory controls for a future opt-in live runner.
It has no SDK import, credential access, network call or executable provisioning
command. Run its deterministic tests with `pnpm test:boat:live-guard`.

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
resources. The future runner must authenticate through a read-only account lookup
and match the returned native ID before calling `reserve`. Merely setting
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
5. `deleted(providerId, jobId)` is allowed only after the caller has independently
   validated the native job's ID, sandbox target, kind and completed status.
   This bookkeeping call does not verify provider evidence itself.

Deletion remains available after the admission deadline. Counts never reset
when machines are deleted. The inventory never exposes a fully cleaned state.
Even after confirmed VM deletion it reports
`vm-deleted-snapshots-unverified`, because the current adapter enables native
snapshots and VM deletion alone does not prove removal of those artifacts.

After a restart, `readInventory(file)` reconstructs the recorded state without
network access or replaying mutations. Existing inventories cannot be reopened
for provisioning. A truncated or invalid inventory throws a fixed unresolved
cleanup error, without echoing its content. A pending intent without a native ID
requires provider-assisted investigation if the API has no authoritative
read-only idempotency lookup. Never find targets by names, scan-delete an account,
or treat a 404 as proof of completed deletion.

## Remaining live runner work

The guards are tested infrastructure, not completed live qualification. The next
step must wire them to the public Boat adapter, add scoped read-only preflight
and bounded status polling, retain accepted native handles before later reads,
and implement an explicit cleanup report. It must account for snapshot artifacts
and ambiguous native replies before claiming cleanup. Signal handling and crash
reporting also need verification. Cancellation, direct transfers, image capture
and expiring connections must retain their documented unsupported results.

CI remains offline. Provider support and release qualification require the
reviewed runner, approved disposable account and budget, and actual live evidence.
