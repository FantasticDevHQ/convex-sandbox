# Offline Boat qualification

The adapter uses the exported baseline adapterConformance factory with synthetic
native HTTP. It does not maintain a second conformance runner or provider state
engine. The wire fixture delegates its in-memory machines, files, commands and
forks to the existing baseline simulator, then maps the results to audited Boat
response shapes. It never executes fixture shell text, touches a guest filesystem
or sends a live provider request.

The tested provider is the real public createBoatProvider factory, including the
pinned SDK, bounded transport and shared stores. A failing global-fetch trap in
the unit suite verifies that the injected HTTP path handles every request. Keys
are explicit synthetic literals; no account credentials are read. Each baseline
case gets an isolated fixture; cleanup disposes all owned in-memory machines,
including resources whose replies were deliberately concealed.

## Case coverage and skips

| Baseline case | Expected Boat result |
| --- | --- |
| capability declarations | pass; methods match advertised capabilities |
| lifecycle and persistence | pass; native stop/resume/deletion and truthful unknown disk retention |
| observation ordering | pass; shared refresh ticket fences |
| provisioning concurrency | pass; one dispatch per shared claim |
| provisioning rejected retry | pass; retained rejection is not redispatched |
| provisioning lost reply | pass; unknown stays unknown without another POST |
| execution uncertainty | pass; missing execution identity never permits replay |
| cancellation acknowledgement | skipped explicitly because cancelExecution is unsupported |
| execution logs | pass; native history offsets preserve output |
| bounded output | pass; a closed incomplete cache is visibly truncated |
| files and path guards | pass; native encodings, bounds and path checks |
| optional capability guards | pass; unadvertised operations do not reach SDK methods |
| native images and connections | pass for advertised fork/catalog branches; unsupported branches stay disabled |

The report is 12 passed, one skipped, 13 total. A composite case passing does not
claim support for its unadvertised branches. Provider-specific tests separately
cover native pending states, malformed/foreign identities, rate limits, capacity,
abort/body bounds, lost responses, unsupported transfer/connection/image forms
and safe errors. [Capability decisions](decision.md) remain authoritative.

The log-bound case exposed a shared cache issue: small native pages could hit the
32-chunk cap below the 64 KiB cap and close without a truncation flag. New appends
now mark a stream incomplete when either cache bound closes it before native
completion. A fully completed stream at exactly the chunk cap remains complete.
This changes no limit, validator or schema and does not backfill closed records.

## Package boundaries

Run the focused checks after dependency provisioning:

```sh
pnpm build:lib
pnpm exec vitest run tests/boat/conformance.test.ts --maxWorkers=1
pnpm test:package
```

The package suite verifies:

- The exact SDK is an optional peer, absent from mandatory runtime dependencies.
- Isolated core, testing, server and component imports reject both SDK and Boat
  adapter module loads; browser imports of the Boat entry remain server-only.
- A tarball consumer outside the workspace uses public exports without the SDK;
  the Boat runtime correctly requires its optional peer rather than a phantom
  workspace dependency.
- After exact SDK installation, that same tarball's Boat factory runs through
  injected HTTP and its public BoatOptions/provider types compile under NodeNext.

Package installation can contact the public npm registry to provision dependencies
and metadata. The packed consumer also performs a frozen offline reinstall from
its owned cache. This is distinct from the credential-free, network-trapped
provider conformance execution; no package check calls the Boat service.
The upstream licenses/notices stay intact; the wire fixture copies no upstream
implementation and reuses the baseline interpreter through its testing entry.

## Convex and CI gates

The internal boatConformanceProof runs the same fixture and baseline cases inside
an owned anonymous Convex backend. Both ordinary and packed-package hosts run it
in the existing two-worktree qualification alongside the provider-specific native
probes and restart checks. This verifies the SDK/adapter in Convex V8, not just a
Node test harness. Fixtures are disposable and synthetic; no live resources are
created for cleanup to discover.

Full check:all runs on the existing UbiCloud Linux runner. Review actual Actions
job labels and runner identity with the job's check output before merge; a workflow
label alone is not evidence that the candidate executed there. These offline and
package gates do not qualify a live provider account or publish a release. Live
verification remains a separately approved disposable-resource/budget gate.
