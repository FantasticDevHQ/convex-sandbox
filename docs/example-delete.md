# Confirm exact-owned deletion

Owned machine details include a deletion panel under the verified operator
boundary. It displays the logical key, bound native ID, generation and cleanup
status. Deletion removes retained machine data. Type the exact logical key and
select **Delete selected machine** to confirm the displayed target.

The server requires both that confirmation and a canonical review token for the
current scope/key/provider/native ID/generation. The token grants no authority:
verified operator access still resolves ownership on every request. A changed
binding invalidates the token and clears typed confirmation in the UI. Browsers
cannot supply an arbitrary native deletion target or another owner's scope.

## Shared claims and pinned target

`live/delete:request` resolves the selected binding, verifies the retained approved
account/wallet and uses the public shared lifecycle client. Its operation ID is
stable per logical binding generation: `delete-<generation>`. An existing operation
is inspected rather than dispatched again. An unrelated unfinished operation must
be reconciled first. No direct native DELETE or account scan is exposed.

The shared host helper pins authorization to its resolved reference and generation;
its provider callbacks refuse a changed target. The request also compares the
reviewed snapshot before invoking the shared operation. Component versions,
execution claims and generation fences prevent concurrent requests or stale
completion from mutating a replacement binding.

The host helper is shared with stop/resume. It reads retained approval independently
of a malformed or expired proposed plan, so exact-owned cleanup/recovery does not
require new spending approval. It still requires the original server-selected
account and wallet identity to match; credentials remain server-only. New billable
work continues to require a current valid proposal and allowance admission.

## Acceptance stays pending

The Boat adapter retains the native deletion job and exact target. The initial
DELETE response is acceptance, including when its body already says `completed`.
It records a transitional observation; it does not immediately tombstone the
registry. The panel displays **Pending cleanup** and the original operation.

**Inspect original deletion** performs one bounded shared reconciliation attempt,
up to five seconds, against the retained native job. Only a separate completed job
with the same job ID, sandbox kind and exact target produces an accepted deletion
observation. The shared component then retains the registry tombstone and operation
record. The panel displays **Confirmed deletion** from that matching succeeded
operation and current tombstone, without fabricating completion from an action return.

A 404, missing response, changed job ID, wrong kind or wrong target leaves cleanup
unresolved. Inspection never issues another DELETE. No unknown child is guessed,
no account resources are scan-deleted, and no private journal or historical intent
is reset or replayed. Repeated inspection of confirmed deletion returns retained
proof. Tombstones and job/operation records remain available for recovery.

This workflow does not reset cumulative machine/start/dollar allowances or release
unidentified reservations. Exact-owned run cleanup/accounting is handled separately;
confirmed deletion of one fixture is not proof that no stopped unknown child exists.
Provider-wide qualification and the historical unresolved fork remain open.

## Deterministic verification and setup

`example/convex/live/delete.test.ts` exercises actual consumer endpoints, shared
claims and the Boat transport with injected responses. It checks duplicate dispatch,
matching completion and tombstone retention, wrong-target refusal, 404 ambiguity,
completed acceptance remaining pending, authority/confirmation/stale-snapshot denial,
and recovery from a retained approval despite malformed proposal configuration.
`example/e2e/delete.spec.ts` renders the production panel with labeled synthetic
jobs to check typed confirmation, pending/confirmed/unresolved states, and confirmation
reset when the target changes. These are offline checks, not live deletion evidence.

No live plan, operator grants, credentials or native resources are configured by
this implementation. Hosted Convex setup must verify the actual FantasticDev team
slug/ID, reuse its correct existing project and verify the selected deployment.
Local worktrees keep isolated anonymous backends, allocated ports and checkout-local
state under the adopted lifecycle commands. Production deployment, Boat provisioning
and package publication remain outside this implementation's authority.

Additional deterministic race tests inject a rebind after the request's final
snapshot read, before the shared lifecycle rereads the registry. Both replacement
native ID and same-ID/new-generation cases refuse dispatch. Recovery tests also
exercise expired approval, changed account/wallet refusal, and preservation of a
nonzero allowance ledger through confirmed deletion. Test-only context interception
is confined to the suite; no runtime override or public test endpoint is exposed.
