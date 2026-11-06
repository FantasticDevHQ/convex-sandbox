# Stop, resume and verify retained bytes

Owned machine details include a lifecycle panel under the verified operator
boundary. It shows accepted component state, the unfinished operation and any
retained native job. Stop discards RAM and processes. Disk persistence is a
workflow observation that must be verified for the exact owned fixture; it is
not a provider-wide preservation claim.

## Prepare the original fixture

On an observed-running owned Boat machine, select **Prepare retained home
fixture** before stopping it. The host allocates a unique file under
`/home/user/.convex-sandbox-<fixture-id>.txt`; it never overwrites a generic
user filename or uses `/tmp` (which Boat snapshots exclude). The record binds
its path and original expected text to the operator scope, logical key, native
ID and generation. The shared file client writes bounded UTF-8 bytes and reads
them back before recording initial verification.

Only this exact path and binding are authorized, with a 512-byte read/write
bound. A written fixture is not rewritten by subsequent preparation requests.
The original expected bytes survive restart; a changed binding refuses reuse.
A failed or interrupted preparation remains unverified. No guest environment
secrets, provider responses or connection URLs are persisted.

## Separate acceptance from completion

**Stop owned machine** invokes the public shared lifecycle `run` client with a
stable prefixed operation identity. It remains possible after admission expires,
using the retained approval's original account and wallet, verified with read-only
setup. A missing/mismatched original account fails closed. Stop does not require
a prepared fixture, so lack of a fixture does not prevent exact-owned shutdown.

An accepted stop may show `stopping`, an unfinished operation and its native job.
It is not complete merely because the action returned. **Inspect progress and
verify bytes** performs one bounded shared reconciliation attempt (at most five
seconds), including the retained native job and current machine observation.
The view remains subscribed to component state; no native polling loop or
parallel lifecycle owner is introduced.

## Resume within the approved run

Once stop is confirmed and the home fixture was initially verified, **Resume
approved machine** requires a still-active reviewed run and reserves another
start, estimated allowance share and concurrent slot atomically. The provider
uses the reviewed duration as its requested TTL and `noEnv: true`. Acceptance
shows `starting`; it does not verify disk bytes or preserve RAM.

When an inspection confirms the original resume operation succeeded and the
exact binding is running, the workflow reads the retained home path through the
shared file client. It compares the complete bounded bytes with the original
text. Only an exact match records **Bytes verified**. A mismatch records a failure;
a read failure or incomplete readiness never claims persistence. A later explicit
inspection can retry the read without replaying resume.

An admission interrupted before the component claim stays visible by its original
intent. A replacement resume intent is refused. The per-machine outstanding-start check
and reservation insert run in the same transaction, so distinct concurrent intents
cannot overwrite the fixture link or each reserve a slot. Accepted/unknown shared operations
retain their own identity and job for reconciliation instead of dispatching again.

## Concurrency release is exact and conservative

A confirmed stop can release concurrent slots for this exact physical machine,
through the internal `live/allowance:releaseStopped` mutation. It requires a
successful stop operation with the current reference and generation, a stopped
non-tombstoned registry record, and no active operation. Creation reservations
also require their original successful shared provision with matching native ID;
start reservations require an earlier shared start operation for this generation
and reference. Repeated release is idempotent.

Release changes only `activeReservations` and marks those proven reservations
released. Cumulative machines, starts and estimated dollars never reset. A lost
creation reply with no confirmed child identity cannot be released by another
machine's stop. Neither zero active machines nor an empty list proves that no
stopped child exists. An interrupted or unknown reservation remains counted until
its own exact proof is available. Delayed unknown-result updates cannot reopen an
already proven released reservation.

Admission expiry is not a shutdown guarantee or provider billing cap. Stopped
resources and cleanup failures may still incur charges. Exact-owned recovery
and cleanup remain necessary; no account scan, guessed ID, journal reset or
historical-intent replay is authorized by this workflow.

## Verification and setup boundaries

`example/convex/live/lifecycle.test.ts` runs actual consumer actions and shared
clients against deterministic synthetic transport responses. It covers foreign
binding refusal before mutation, accepted jobs, readiness before original-byte
comparison, mismatch failure, exact concurrency release, retained unknown child
reservations and interrupted resume admission. Browser tests render the production
panel with explicitly synthetic jobs and byte results. Their fixture does not
qualify external authentication or a real provider run.

Before hosted configuration, verify the actual FantasticDev Convex team slug/ID,
reuse its correct existing project and verify the selected deployment. This
implementation configures no hosted backend, operator grants, live approval or
Boat credentials. Local worktrees use the adopted managed anonymous lifecycle,
allocated ports and checkout-local data. The historical unresolved native fork
intent remains unresolved and must not be replayed or reset.
