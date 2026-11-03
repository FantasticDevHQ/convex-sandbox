# Adapter conformance and simulated provider

`@fantastic.dev/convex-sandbox/testing` exports the component's `register` helper, `createTestStores`, `createSimulatedProvider`, `instrumentAdapter`, `adapterConformance` and `runAdapterConformance`. The entry is separate from core exports. Its JavaScript imports no React, test runner or convex-test runtime. `register`/`createTestStores` use the optional convex-test peer for host setup and TypeScript declarations; the cases themselves need no test-framework API.

This is an experimental exported test API. Package publication/versioning remains part of the release project. Conformance is a bounded contract check, not provider certification or proof of real VM security, desktop streaming, snapshot portability or native resource retention beyond the tested workload.

## Run against an adapter

Supply a factory that returns a fresh isolated `ConformanceFixture` **for every case**. It contains a provider registration, component stores, a logical sandbox key, three harmless command fixtures and expected stdout. For offline component tests:

```ts
const factory = () => {
  const t = convexTest(defineSchema({}), hostModules);
  const component = register(t);
  const simulated = createSimulatedProvider({ profile: "persistent" });
  return {
    provider: simulated.provider,
    sandbox: { scope: "test-fixture", key: "machine" },
    stores: createTestStores(t, component, async ({ path }) =>
      path === "/workspace" || path.startsWith("/workspace/")),
    commands: {
      complete: { kind: "argv", executable: "fixture", args: ["echo", "conformance"] },
      running: { kind: "argv", executable: "fixture", args: ["progress", "4", "conformance"] },
      largeOutput: { kind: "argv", executable: "fixture", args: ["generate", "100000"] },
    },
    expectedOutput: "conformance\n",
    cleanup: async () => {}, // This fixture owns only in-memory data.
  };
};
```

`hostModules` is the consuming test application's generated server/module map. Production auth is not implied by these fixture identities or the suite's no-op test authorization. Never expose the conformance runner as a public application endpoint.

Register cases with Vitest, node:test or another runner:

```ts
for (const { name, run } of adapterConformance(factory)) {
  test(name, async () => {
    const result = await run();
    // Map result.status === "skipped" to your runner's skip API if desired.
  });
}
const report = await runAdapterConformance(factory); // Sequential, fail-fast report.
```

A case returns `{ name, status: "passed" | "skipped", reason? }`, or throws `ConformanceFailure`. Skips name missing capabilities or fixture prerequisites. Review skips explicitly; a skipped operation is not verified support. Known assertion failures retain safe contract messages; unexpected SDK/factory/cleanup errors are sanitized and do not include raw SDK messages, credentials, URLs or output. Cleanup runs after success, failure and skip; cleanup failures fail the case.

For future provider projects, replace only the factory's provider registration and command fixtures. Use the normal `createLifecycleStore`, `createExecutionStore`, `createFileStore` and `createImageStore` bridges for real anonymous host actions, or `createTestStores` with convex-test. No core edits are required.

The cases cover:

- Advertised method declarations and optional direction/kind metadata.
- Lifecycle convergence, declared disk retention/discard, pause/resume selection and deletion tombstones.
- Observation ordering and rejection of late state.
- Concurrent provisioning, a fresh request after rejected creation, and lost replies without duplicate creation.
- Execution uncertainty without redispatch, optional read-only lookup, cancellation intent versus acknowledgement, bounded output and ordered log pagination.
- Text/binary contents and length, file page bounds, traversal rejection before native dispatch, native deletion and supported transfer handles.
- Unsupported snapshot/connection guards without native SDK calls.
- Native snapshot/restore/fork/template readiness, distinct physical identities, template creation and expiring connection metadata where advertised.

`pollBudget` is 1..32, default 8. `beforePoll` can synchronize a provider-specific disposable fixture. Polls are bounded; the kit creates no scheduler, infinite retry or implicit shell process. `fileRoot` defaults to `/workspace`; a provider fixture must pre-create an empty, owned test directory and authorize only that root. `prepare` can bind a pre-existing disposable resource for an adapter without create support. Native create-from-template without template creation needs `templateId`; restore without snapshot creation needs `restoreImage`.

The running command must remain active until cancellation; the large-output fixture must exercise truncation or the 64 KiB output bound. Keep all command/file contents synthetic. Protected no-text stores intentionally cannot satisfy an expected-output fixture; use isolated synthetic output when testing the output contract.

The suite uses generic SDK-boundary fault injection. An after-call fault can conceal a successfully created resource or started command. A live provider factory must explicitly opt into real cloud work and own cleanup/inventory for every resource, including ambiguous outcomes and forked/template-derived machines. The kit does not discover or delete unrelated resources. Baseline checks use only the in-memory simulator, without cloud credentials or network access.

## Deterministic simulator

```ts
const simulated = createSimulatedProvider({
  name: "simulated",
  profile: "persistent",
  idempotency: "native", // Or "none" to exercise one-shot core admission.
});
providers.register(simulated.provider);
```

This uses the same public `registerProvider` and `SandboxProviders` path as an external adapter. It is a bounded fixture interpreter, not a shell, VM, desktop or agent runtime. It imports no OS filesystem/process/network API, executes no host commands, and never fetches its synthetic URLs. Descriptions report fixed synthetic resources: 1 CPU, 1024 MiB RAM and 4096 MiB disk. Different requested resource values fail as unsupported.

| Profile | Stop observation | Disk on stop | Memory on stop | Optional fixture features |
| --- | --- | --- | --- | --- |
| `ephemeral` | stopped | discarded | discarded | Core lifecycle, execution, files |
| `persistent` | stopped | retained | discarded | Disk images, template/fork/restore, preview, synthetic download handle |
| `memory` | paused | retained | retained in fixture state | Explicit resumeMemory plus preview/desktop/browser/SSH metadata |

Memory retention here means retained interpreter records, not actual RAM snapshots. Disk image fixtures copy file data only. Connection/transfer URLs use `simulated.invalid` and are nonfunctional metadata fixtures. They must not be presented as working remote desktops or downloads.

Only argv input with executable `fixture` is accepted. Shell input is rejected. Instructions are `echo ...`, `exit CODE`, `progress POLLS TEXT...`, `generate BYTE_COUNT`, `write PATH TEXT`, and `read PATH`. `progress` advances through queued/running/completed on status calls. Cancellation acknowledgement is separate; a later status observes cancellation. Unknown instructions exit 127. No ambient host environment or shell syntax is evaluated.

`generate` accepts at most 1 MiB requested output and materializes at most 64 KiB, with explicit truncation. The filesystem contains ordinary file bytes and implicit directories beneath `/workspace`; it has no symlinks, permissions model, mounts or OS fidelity. Names sort by deterministic code-unit ordering. Native log cursors retain their meaning across different requested page byte budgets and preserve UTF-8 boundaries.

Limits are 8 retained machines, 64 files per machine, 64 KiB per file, 32 executions per machine, 16 images, 32 image jobs, 64 provisioning correlation entries, and 512 KiB UTF-8 JSON for the entire serialized fixture state. Deleted machines still count toward that bounded fixture history. Image/fork copies and output consume the same state budget. Exceeding a mutation limit rolls the mutation back and reports a not-started quota error.

`snapshot()` returns a detached, versioned JSON-compatible `SimulatedState`. Restore with `createSimulatedProvider({ state })`. Validation checks shape, byte bounds, native resource relationships, unique IDs and counters before accepting state. Names/profiles/idempotency cannot be switched during restore. Persist this separately from component records if a consuming demo needs continuity between actions. It is a test-fixture checkpoint, not a sandbox-provider snapshot or durable storage implementation. The caller must retain post-side-effect state even when deliberately concealing a reply. Fault queues/counters are transient and are not restored.

## Deterministic failures

```ts
simulated.faults.failNext("create", "before");
// capacity / not_started, before the wrapped SDK method runs.
simulated.faults.failNext("execution.start", "after");
// unknown_outcome after the SDK side effect, without returning its result.
const counts = simulated.faults.counts(); // Method counts only, no arguments/output.
```

The same `instrumentAdapter(registration)` helper works with a future provider. It preserves method receivers, including prototype methods/private fields, and copies metadata arrays. Plans are FIFO per implemented method, with at most 32 queued faults. An after fault applies only if the underlying call succeeds; an underlying SDK exception wins. Counts distinguish attempts from dispatched SDK calls, not proven side effects. Core clients must reconcile uncertainty rather than retry automatically.

## Checkpointing a simulator

`createSimulatedProvider({ onChange })` optionally awaits an asynchronous checkpoint callback after each successful state mutation, before returning to the fault injector. Mutations are serialized; the callback receives a detached `SimulatedState`. Load it into a new instance with `{ state }` to preserve native correlation and synthetic files across action or backend restarts. The callback is a host storage hook, not a scheduler or production agent runtime.

Quota/validation failures roll back before checkpointing. If the checkpoint rejects, the SDK reports a sanitized `unknown_outcome`: persistence may already have committed, so changed in-memory state is retained and the caller must reconcile rather than blindly retry. The host must fence concurrent writers; the [local example](example-backend.md) uses an epoch and expiring lease token. Pending commands expose output only after completion; cancellation before completion discards their planned output.
