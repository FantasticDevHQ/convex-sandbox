# Boat adapter transport decision

Status: accepted for implementation subject to the reproducible runtime gate below.
This decision does not qualify a live provider or publish an adapter.
Source review date: 2026-11-04.

## Decision

Use official `@boatdev/sdk` low-level `BoatApi` methods in a separate server-only
optional adapter entry. Inject host-owned fetch and account configuration, forward
the shared call's abort signal, and exclude middleware that retries requests.
Keep the SDK out of the core runtime dependency graph. It is an optional peer
for the [experimental observation entry](setup.md), with a development pin for
the compatibility probe. Core consumers need no Boat dependency or credentials.

Keep the shared component's registry, claims, authorization boundary, deadlines,
operation history and reconciliation. Do not mount `@boatdev/convex` inside it.
That component has its own sandbox table, settle scheduler and retry policy. Its
public client delegates to mounted component actions/queries; it does not export
a standalone stateless transport.

If the SDK fails the default-runtime gate after an upgrade, use a small native API
fetch transport. Selectively reuse MIT transport code only after adapting injected
configuration, abort propagation and safe error projection. Do not fork the whole
component or introduce a second lifecycle owner.

## Source and license inventory

Distinct artifacts were reviewed. A source manifest does not prove npm release.

| Artifact | Exact version or digest | License |
| --- | --- | --- |
| [boat-convex source](https://github.com/ariana-dot-dev/boat-convex/tree/168ecde17e4d118400f5121132aaecd61e22d416) | Commit `168ecde17e4d118400f5121132aaecd61e22d416`; manifest `0.2.0` | MIT, copyright 2026 Ariana |
| Published `@boatdev/convex` metadata | npm `0.1.0`; integrity below | MIT metadata; the implementation audit is of the pinned Git artifact |
| Official `@boatdev/sdk` | npm `1.13.0`, exact development pin and integrity in `pnpm-lock.yaml` | MIT metadata |
| [Boat OpenAPI](https://docs.boat.dev/openapi/boat-v1.yaml) | SHA-256 `9f2abcf0735ba6230fba1b40ac9a11fe9022348997152821f3b99a1f7c2421fc` | Reference spec, not vendored |

Published component integrity:

```text
sha512-pr7xyGLtSJH6jGEn6A20lqi6ZHXHAQ7Dd01AS/p6AL8Y6UyAWiHmSG08eo9VGDnC3N7YlgmxGp7RaNC4VEFxhg==
```

SDK integrity:

```text
sha512-wSmCyFLDL0QTCLF5NfQR4JTdTccFIvlqBBtCMDLPk61hLj48ZPEH/0nF91j4aiMLBkr+kvmkedfqkyFuokn5dw==
```

Public read-only reproduction:

```sh
git ls-remote https://github.com/ariana-dot-dev/boat-convex.git refs/heads/main
npm view @boatdev/convex@0.1.0 version license dist.integrity --json
npm view @boatdev/sdk@1.13.0 version license dist.integrity --json
curl -fsSL https://docs.boat.dev/openapi/boat-v1.yaml | shasum -a 256
```

The live branch/spec can change. Compare with these pins before upgrading. No
upstream implementation is copied here. Later copied or substantially adapted
code must retain the upstream copyright and MIT permission notice in the
distributed artifact. Package metadata alone does not establish copied-source
provenance.

## Why this boundary

The upstream [lifecycle implementation](https://github.com/ariana-dot-dev/boat-convex/blob/168ecde17e4d118400f5121132aaecd61e22d416/src/component/lifecycle.ts)
owns sandbox records and schedules settling with `ctx.scheduler.runAfter`.
Its [idempotent POST helper](https://github.com/ariana-dot-dev/boat-convex/blob/168ecde17e4d118400f5121132aaecd61e22d416/src/component/lifecycle.ts#L81-L93)
retries `idempotency_in_progress` POSTs with two-second waits up to ten retries.
That policy competes with the shared five-second request deadline and uncertain
outcome handling. Use this implementation as reference rather than adopting its
control plane.

SDK `1.13.0` has no runtime package dependencies. Its default transport lazily
imports `node:http2` on Node. Inject fetch explicitly rather than relying on
runtime detection. `Configuration.fetchApi` and method `initOverrides.signal`
provide the hooks. An aborted/lost request is wrapped as `FetchError`, which does
not prove a mutation failed to start. `ResponseError` carries a raw response;
project it to the shared safe error format before returning or persisting it.

Exclude `waitUntilReady`, `execCommand`, `runCommand`, `followCommand`, streaming
reconnectors and similar waiting/resend helpers from the adapter. Use one native
request per shared dispatch, then bounded read-only status calls. See the
[official SDK documentation](https://docs.boat.dev/sdks/typescript).

## Reproducible runtime gate

`scripts/boat/sdk-probe.ts` uses the real pinned SDK with synthetic fetch responses.
`tests/boat/runtime.test.ts` rejects global network fetch. The internal
`example/convex/boatProbe.ts` action runs the same probe in Convex's default runtime
without `"use node"`. Two-worktree qualification bundles, deploys and invokes it on
both owned anonymous backends. No Boat key, account, machine, guest command or
billable resource is involved.

The probe checks injected fetch, wallet/idempotency inputs, detached command
decoding, abort propagation, one call after a lost reply, and no retry for HTTP
409, 429 or 502. It checks those low-level paths with no middleware, not every SDK
method or the default HTTP/2 transport.

Run focused checks with the host heavy-job lock and bounded Node heap:

```sh
pnpm exec vitest run tests/boat/runtime.test.ts --maxWorkers=1
```

From a clean committed checkout, follow [local development](../development.md).
`pnpm test:worktree:integration` performs the real runtime gate; `pnpm check:all`
includes it on UbiCloud. Record actual results in PR evidence. A unit-only pass
does not establish V8 compatibility.

## Common capability mapping

This is an implementation plan, not shipped support. Register a capability only
after its adapter and qualification exist. Paths refer to the pinned OpenAPI;
`{id}` means a physical Boat sandbox ID.

| Capability | Native API or explicit limitation |
| --- | --- |
| `create` | `POST /sandboxes`; stable shared `Idempotency-Key`, `noEnv: true`, host-owned wallet/size policy. |
| `describe` | `GET /sandboxes/{id}`; project known state and reported resources, leave missing fields unknown. |
| `start` | `POST /sandboxes/{id}/resume`; observe readiness separately. |
| `stop` | `POST /sandboxes/{id}/stop`, stop status and sandbox observation; preserve pending state. |
| `delete` | `DELETE /sandboxes/{id}` with `X-Ascii-Confirm-Delete`, then deletion-operation and sandbox status. Acceptance is not completion. |
| `execute` | `POST /sandboxes/{id}/commands`, `detached: true`; retain native process/command IDs. Validate shell/argv translation. |
| `cancelExecution` | `DELETE /sandboxes/{id}/commands/{processId}`; acknowledgement is separate from confirmed exit. |
| `executionLogs` | Command status byte/next offsets; history/log endpoints for durable IDs. Old agents can return `agent_outdated`; no fabricated gap-free cursor. |
| `readFile` | `GET /sandboxes/{id}/files`; audit byte/encoding bounds before enabling arbitrary offset reads. No shell fallback. |
| `writeFile` | `PUT /sandboxes/{id}/files`; bounded native content/encoding after host path policy. |
| `listFiles` | `GET /sandboxes/{id}/files/list`; no native cursor in this spec. Bound response bytes, disclose partial results or reject unsupported pagination. |
| `deleteFile` | `DELETE /sandboxes/{id}/files`; explicit native file operation after path policy. |
| `transferFile` | Native `files/download-url` and `files/upload-url`; enable only after validating direction, enforced byte cap and expiry. |
| `listTemplates` | `GET /saved-snapshots`; native names/IDs and readiness. Audit catalog bounds and permissions. |
| `createTemplate` | `POST /saved-snapshots`, poll `GET /saved-snapshots/{name}`; host-controlled name, asynchronous readiness and replacement semantics. |
| `createFromTemplate` | `POST /sandboxes` with native `from`; new physical identity and explicit safe environment policy. |
| `fork` | `POST /sandboxes/{id}/fork`; new physical identity, no automatic destination binding. |
| `restore` | Unsupported. `recover` power-cycles, not restore of a chosen image into the existing machine. Create-from-image changes identity. |
| `snapshotDisk` | Candidate: native saved snapshot plus readiness polling, only if stable artifact identity and shared disk-snapshot semantics hold. Background capture alone is not an explicit snapshot operation. |
| `suspendMemory` | Unsupported; reviewed stop/resume does not preserve process RAM. |
| `resumeMemory` | Unsupported; never substitute disk resume. |
| `getConnection` | Initially unsupported. Desktop, port hosting and SSH exist, but reviewed endpoints do not establish the short enforced expiry the common contract requires. Audit each kind separately. No native browser connection mapping established. |

## Recovery and security constraints

- Create keys are account-scoped and retained for 24 hours with matching-body
  requirements. No authoritative read-only lookup by key was found. Leave
  `findCreate` absent and outcomes unknown. Repeated POSTs or display-name matches
  are not read-only reconciliation.
- Command starts have no audited native idempotency/correlation lookup. Declare
  execution idempotency `none`. A 502 can mean already running. Never resend or
  match command text to discover an execution's identity.
- Stop normally retains disk through snapshots and discards RAM/processes.
  `snapshots: false`, retention policy and forced-stop failures can remove disk
  recovery. Reject incompatible settings or disclose limits; never promise
  unconditional retention.
- `ttlSeconds` is a deadline after create/resume, not inactivity detection. Do not
  populate common `idleTimeoutMs` from it.
- `noEnv: true` prevents account environment/credential inheritance for guests.
  Any override belongs to trusted host policy. Provider keys stay outside guest
  environments and browser responses.
- Scope requests to the configured account/wallet. Do not mutate the global
  active organization to serve concurrent requests.
- Signed URLs can be bearer credentials. Approved handles belong in authenticated
  action responses with truthful access/expiry, never registry/operation records.

Reuse native Boat commands, files and images. Agent loops, Git services, credential
administration, guest desktops/profiles, external durable storage and consumer
topology are separate work. Endpoint existence does not prove desktop isolation,
security or live behavior.
