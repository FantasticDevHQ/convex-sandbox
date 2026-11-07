# Changelog

All notable changes to this project will be documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/) and
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Fresh packed-app build qualification and actual anonymous-backend isolation checks for retained app run journals.

- Credential-free mounted workflow browser qualification with fatal HTTP/WebSocket traps and visible native-failure assertions.

- Optional workflow developer views with exact host source, checked public exports and credential regression guards.

- Exact-owned run cleanup with child-first deletion, unresolved intent retention and guarded view archival.

- Scoped Operations recovery with retained history, original-ID read-only inspection and anonymous backend restart qualification.

- Optional accepted fork child references in shared image operations, allowing
  explicit host-authorized child binding before readiness and fencing later
  status replies to the same child.

- Optional durable native lifecycle job handles in shared operations, with scoped
  read-only reconciliation after restart and protection against stale state or
  changed job identity. No provider-specific state or additional scheduler.

- Experimental optional server-only Boat adapter with shared-claim creation,
  safe private guest defaults, explicit account configuration, bounded stable
  native keys, abort/deadline/response bounds and safe errors. Native stop, disk
  resume and asynchronous deletion use shared lifecycle jobs with restart recovery.
  Detached commands use durable history IDs, literal argv translation and read-only
  reconciliation; ambiguous starts never redispatch. Per-command env and runtime
  timeouts are explicitly unsupported. Bounded history logs persist native byte
  offsets with UTF-8 boundary handling and explicit gaps. PID-only cancellation
  remains unsupported because the API lacks an atomic command identity guard.
  Native inline files use a 64 KiB byte bound, host path policy, nonrecursive
  deletion and explicit partial directory listings. Unbounded native transfer
  URLs remain unsupported. Native forks retain new physical IDs and reconcile
  readiness after restart; the bounded saved-template catalog preserves mutable
  names and source-scoped readiness. Capture mutations and in-place restore remain
  unsupported where native job identity or semantics cannot be preserved. The
  per-kind connection audit keeps access unsupported without native enforced
  expiry; regression/runtime fixtures verify no setup dispatch or durable bearer
  metadata. Shared refresh qualification covers native reply ordering, rebind
  generations and polling budgets, with a live local query-subscription proof.
  Host scheduling and the separate signed-webhook ingress follow-up are documented.
  The public Boat factory is covered by baseline conformance over synthetic native
  HTTP, with explicit capability skips, dependency isolation and packed runtime/type
  checks. A Boat host guide includes a compiled, tested authenticated wrapper
  with server-side credentials, owner binding resolution, explicit configuration
  failure and dated capability limits. The runnable playground remains simulated.
  Other Boat operations and live qualification remain pending.

### Fixed

- Boat log reads retain their cursor after a currently drained native page, so
  later detached output remains readable. Incomplete UTF-8 suffixes wait at their
  original offset instead of being consumed when native `done` is reported.

- Boat deletion acceptance retains its job and stays pending even when the initial
  response reports completed; a separate matching status read confirms deletion.

- Boat create acknowledgements remain starting until an independent observation,
  including when the creation reply itself reports ready.

- Re-resolve a refresh binding when deletion/rebind changes its generation before
  ticket acquisition, so an old native observation cannot be accepted for the new
  binding, and reauthorize the final current binding before returning refresh
  results.

- Mark unfinished execution output truncated when the shared chunk cap closes it
  before the byte cap, while preserving a fully drained stream at the exact cap.

## [0.1.0-rc.0] - 2026-11-03

Prepared release candidate; not published to npm. The package remains private
until the owner approves and configures an actual registry release.

### Added

- Provider-neutral Convex contracts, capability registration, registry state and
  versioned lifecycle/provisioning operations with explicit reconciliation.
- Command identity, cancellation acknowledgement and bounded cached output;
  native file, image, template and expiring connection contracts.
- Host authorization helpers, protected output/error boundaries and a separate
  simulator/conformance entry point without mandatory React or test-runner imports.
- A TanStack Router playground using durable synthetic fixtures, anonymous local
  backends, checked documentation samples and packed-package consumer qualification.
- Manual candidate artifacts with source/lockfile identity, SHA256 checksums and
  workflow build attestations. No registry publishing automation is enabled.

### Limitations

- Boat, E2B and Daytona adapters remain separate integrations. The included
  simulator runs no real VM, shell or cloud compute and proves no provider security.
- Pre-1.0 APIs may change. The candidate does not establish production readiness,
  exactly-once effects, native image portability or a time-based retention SLA.
- Unknown create/command outcomes need reliable native lookup or explicit operator
  resolution. Core does not retry commands to discover whether they ran.
- External durable storage, desktop/session management, custom guest images,
  schedulers, billing and agent runtimes are outside this baseline.
