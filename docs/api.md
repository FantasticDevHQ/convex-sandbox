# API map

All imports below are public package entry points. The baseline is experimental and currently unpublished. The [quickstart](quickstart.md) explains local tarball installation without private source imports.

| Entry point | Purpose |
| --- | --- |
| `@fantastic.dev/convex-sandbox` | `SandboxProviders`, `registerProvider`, operation clients/store bridges, common types and Convex validators |
| `@fantastic.dev/convex-sandbox/convex.config.js` | Component definition mounted with `app.use(sandbox)` |
| `@fantastic.dev/convex-sandbox/_generated/component.js` | Generated component API types |
| `@fantastic.dev/convex-sandbox/server` | `createHostAccess`, protected execution output, safe errors and secret-handle helpers; rejects browser imports |
| `@fantastic.dev/convex-sandbox/testing` | Simulator, fault injection, adapter conformance, component registration/test stores; convex-test is optional and only needed for its helpers/types |

## Host clients and state

Construct clients inside a trusted host action. `SandboxProviders` registers configured adapters, checks capability support and authorizes SDK calls. Store bridges project serializable arguments through `ctx.runQuery` and `ctx.runMutation`; callbacks and SDK objects remain action-local.

| Client/helper | Main operations | Durable component state |
| --- | --- | --- |
| `providers.lifecycle(createLifecycleStore(...))` | `create`, `get`, `run`, `refresh`, `reconcileCreate`, `reconcile`, `observe` | Registry binding, provisioning claims, lifecycle operations |
| `providers.execution(createExecutionStore(...))` | `start`, `get`, `status`, `cancel`, `wait`, `run`, `syncLogs`, `logs` | Execution identity/state, cancellation acknowledgement, bounded cached output |
| `providers.files(createFileStore(...))` | `readText`, `read`, `writeText`, `write`, `list`, `delete`, `transfer` | Registry authorization; file contents stay with the provider/host's selected storage |
| `providers.images(createImageStore(...))` | `run`, `get`, `status`, `listTemplates`, `connection` | Native artifact/job identity on operations; access handles are ephemeral |
| `createHostAccess(...)` | `resolve`, `get`, `list`, `create`, authorization/path callbacks | Host derives authority from verified auth and stored bindings |

Add `authorizePath` to the file store. Wrap execution stores with `protectExecutionStore` before exposing public actions; the default retains no output text. Wrap public errors with `withSandboxErrors`. A library client alone does not authenticate an application endpoint.

Host queries read `components.sandbox.registry`, `operations`, `execution` and lifecycle provisioning functions through the generated component reference. Expose only authorized, projected records to browser subscriptions. The [state reference](state.md) describes indexes, generations, observation ordering and bounded history. Direct component calls are trusted backend operations, not browser endpoints.

## Semantics to preserve

- **Logical identity:** `{ scope, key }` is separate from `{ provider, providerId }`. Both are opaque identifiers, never credentials. The host owns their mapping and authorization.
- **Lifecycle:** requested state and observed state are separate. Stop does not delete. Disk retention and memory retention are separately reported; paused memory needs explicit resume support.
- **Uncertainty:** an SDK timeout/lost reply can mean the effect happened. Keep the operation ID and reconcile by native identity/read-only lookup. Do not redispatch create or execute to test an unknown outcome.
- **Execution:** completed process state includes nonzero exit codes; the generic operation can be failed. Cancellation intent, provider acknowledgement and observed cancellation are separate. Bounded wait is not durable background scheduling.
- **Files:** inline byte bounds, pagination and path authorization are part of the contract. Native transfer handles expire and may be partial. No shared object store or cross-image file migration is installed.
- **Images/connections:** snapshots/templates/jobs are provider-native and may be pending. Restore/fork support does not establish portability. Access handles are not permanent connection credentials or durable component state.
- **Retention:** bounded history/output is not a time-based retention SLA or automatic purge. Stop/sleep, provider resource lifetime and guest disk persistence must be checked with the adapter/provider separately.

Capability metadata is versioned and server-owned. Missing support yields a structured unsupported result/error before native dispatch; it never falls back to a shell. Resource fields report known allocations, not utilization or inferred zero values. Provider-specific extension names use the provider namespace and validators.

## Errors and limits

`SandboxProviderError` carries a fixed code, `outcome` and `retryable`, with an optional capability. Known pre-dispatch refusals can be recorded failed; ambiguous dispatch remains unknown. Retryability does not authorize automatic replay. A host error wrapper drops raw SDK bodies/messages/stacks and provider-specific codes. Missing permissions remain denied even if an adapter supports the operation.

Consult the focused guides for exact bounds and method input/return types:

- [Contracts and capability registration](contracts.md)
- [Registry, operation admission and ordering](state.md)
- [Lifecycle and creation recovery](lifecycle.md)
- [Execution, cancellation and log pagination](execution.md)
- [Files and transfer handles](files.md)
- [Images, templates and connections](images.md)
- [Host authorization, errors and credentials](security.md)
- [Adapter tests and simulator persistence](testing.md)
