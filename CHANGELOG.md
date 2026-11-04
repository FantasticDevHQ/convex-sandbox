# Changelog

All notable changes to this project will be documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/) and
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Experimental optional server-only Boat adapter with shared-claim creation,
  safe private guest defaults, explicit account configuration, bounded stable
  native keys, abort/deadline/response bounds and safe errors. Start/stop/delete
  and other Boat operations remain unsupported pending their integration work.

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
