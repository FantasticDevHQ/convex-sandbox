# Common contracts

These pre-1.0 contracts are experimental. Provider integration projects may refine
them before release. The provider dispatcher supports description and lifecycle operations.
Execution dispatch is covered by the [execution guide](execution.md). Native file operations
are covered by the [file guide](files.md). See the [lifecycle guide](lifecycle.md). The component registry now
persists operation tracking; see the [state guide](state.md).

## Identity and values

`SandboxKey` contains opaque `scope` and `key` strings supplied by the host.
It imposes no account, bot, desktop or shared-machine topology. `ProviderReference`
contains `provider` and `providerId` and can change without changing the logical
sandbox key. Neither identity is an authorization credential.

`MachineResources` reports allocated `cpuCount`, `memoryMiB` and `diskMiB` when
known. CPU counts may be fractional. Missing values mean unknown. The provider
boundary rejects non-finite and non-positive reported values. Convex validators
check wire types; semantic resource limits belong in the operation that accepts
them. These fields do not report current utilization or promise resize support.

`SandboxDescription` combines logical identity, provider reference, normalized
state and optional resources. States are starting, running, stopping, stopped,
paused, deleted, error and unknown. Provider adapters must map SDK states
explicitly. They must not infer that an unknown state is running.

`OperationHandle` identifies an application operation by sandbox and operation ID.
`ExecutionHandle` adds the provider reference and provider execution ID. These
handles contain no SDK objects, callbacks, access URLs or credentials. Operation
status is pending, running, succeeded, failed, cancelled or unknown. `LifecycleResult` adds
an optional operation handle to a description. Observed state is not a guarantee
that an asynchronous lifecycle operation has completed. No retry or exactly-once
guarantee follows from a handle.

Every wire type above is inferred from its exported Convex validator, such as
`sandboxDescriptionValidator` and `executionHandleValidator`. Use those validators
in host RPC arguments and return values rather than duplicating field definitions.
The existing narrow observation proof shares its fields with the component schema.

## Provider registration

Construct the registry inside a trusted host action. A minimal adapter can use
fetch or its own SDK. Keep credentials in the host's server-owned configuration.

```ts
import {
  registerProvider,
  SandboxProviders,
} from "@fantastic.dev/convex-sandbox";

const providers = new SandboxProviders({
  authorize: async ({ sandbox, reference, operation }) => {
    // Application code must verify the caller owns this logical sandbox AND
    // that the provider reference belongs to it. Throw on denial.
    await authorizeMachineAccess(sandbox, reference, operation);
  },
});
providers.register(
  registerProvider({
    name: "simulated",
    adapter: {
      describe: async (providerId) => ({ providerId, state: "running" }),
    },
  }),
);
const description = await providers.describe({
  sandbox: { scope: trustedScope, key: "machine" },
  reference: { provider: "simulated", providerId: "provider-machine" },
});
```

`authorizeMachineAccess` and `trustedScope` are application-owned placeholders,
not library exports. Authenticate the action's caller before constructing or using
this boundary. The required authorization callback executes before provider lookup
and before every adapter call. The request is copied and frozen before awaiting it,
so a caller cannot substitute another identity while authorization is pending.
A no-op callback grants access and is appropriate only for internal test fixtures.

Registration accepts arbitrary non-empty provider names without dots. Duplicate
names fail instead of replacing an adapter. Description dispatch validates the
returned provider ID and state, then projects only declared fields. Extra SDK
fields, methods and tokens never appear in its result. Adapter failures propagate
without automatic retry through normalized structured errors. Capability
discovery and retry advice are described below.

## Extension declarations

`registerProvider` accepts an optional `extensions` map. Keys must begin with the
registering provider's name and a dot, followed by a non-empty extension name.
Each declaration contains Convex argument and return validators. The factory
retains their specific inferred types. For example:

```ts
extensions: {
  "simulated.snapshot": {
    args: v.object({ label: v.string() }),
    returns: v.object({ id: v.string() }),
  },
}
```

Import `v` from `convex/values` when declaring validators. These declarations
remain action-local and are not serialized to the component. There is deliberately
no extension execution method yet. Authorization-gated extension dispatch must
land before extensions can run through the common layer.
The core never exposes an arbitrary SDK-method escape hatch.

The older `SandboxBoundary` remains the narrow observation proof. Its host must
authorize before calling it; new provider contracts use `SandboxProviders` with
its required authorization callback. The action-local registry does not persist state by itself. The component
[registry and operation APIs](state.md) provide transactional state and scoped
reactive queries.

## Capability discovery and persistence

`SandboxProviders.capabilities(request)` authorizes the logical identity and
provider reference before returning a frozen snapshot of registered metadata.
It makes no SDK call. Descriptors use `version: 1` and an explicit `supported`
list. Omitting the descriptor preserves the minimal adapter contract by declaring
only `describe`; an explicit empty list disables all operations. Names in this
list describe provider support, not which dispatch methods this baseline has
implemented. Description dispatch, metadata discovery and the lifecycle methods documented
in the [lifecycle guide](lifecycle.md) are implemented.

The common names cover lifecycle operations, execution, bounded file access,
template discovery/creation, disk snapshots, memory suspension/resumption and
connection metadata. Call `requireCapability` before any provider side effect.
Description dispatch applies it after authorization and before calling the adapter.
An unsupported error identifies the missing capability and has `not_started`
outcome. No lifecycle support is inferred from a provider name.

These meanings are distinct:

- `snapshotDisk` captures disk contents. It does not preserve running processes,
  RAM or active network connections and does not promise portability.
- `suspendMemory` preserves process memory for a compatible resume. It is not a
  disk backup and does not by itself establish a retention duration.
- `delete` is terminal deletion of that physical machine. Starting the same
  logical sandbox later does not recover it. A separately retained snapshot or
  external volume has its own provider policy.

Optional `persistence.diskOnStop` and `memoryOnStop` each report retained,
discarded or unknown. Retained means subject to the provider's retention policy;
it does not mean permanent storage. These fields describe stop, not deletion.
Missing persistence data means unknown, not retained.

Optional limits are `idleTimeoutMs`, `maxLifetimeMs`, `diskRetentionMs`,
`maxExecutionMs` and `maxFileBytes`. Present limits must be finite and positive;
absence means unknown or unspecified, never unlimited. They describe provider
constraints, not automatic scheduling, enforcement or current usage. Integrations
must document when retention starts and how their configured limits were derived.
Native feature names use the provider namespace, for example `simulated.git`.
They are discovery metadata and grant no SDK-method execution route.

## Provider failures and retry advice

Adapters classify known SDK failures by throwing `SandboxProviderError`.
`error.data` is the serializable `ProviderErrorData`, validated at RPC boundaries
with `providerErrorValidator`. It carries protocol version 1, a common code,
outcome and retryable hint. It may include a safe provider code, retry delay in
milliseconds and the unavailable capability. Never include raw SDK responses,
messages, headers, tokens or credential-bearing URLs in these fields.

Common codes distinguish validation, authentication, authorization, quota,
rate limit, capacity, timeout, stale/missing resource, unsupported capability,
unregistered provider and unknown outcome. The adapter must supply the safe
provider code explicitly. Core does not guess failure semantics from arbitrary
SDK exception shapes or HTTP status alone.

Description dispatch normalizes exceptions from the SDK call and from reading
its result, including getter-backed SDK fields. Known structured
errors retain their classification and provider code; attached SDK fields are
dropped. Unclassified exceptions become non-retryable `unknown_outcome` errors
with a fixed message and no original exception attached. Invalid returned data
becomes a non-retryable validation error. Host authorization failures remain the
host's errors and occur before provider lookup or capability checks.

Outcome describes effects independently of the error code:

- `not_started` means the provider operation did not begin and caused no effects.
- `failed` means it failed with a known result; partial effects may still exist.
- `unknown` means its effects cannot be established. A timeout after submission
  normally requires this outcome. An `unknown_outcome` code must use it.

`retryAdvice(data, effect)` returns advice only and never repeats a call. For a
write with unknown outcome it returns `reconcile`, regardless of retryability.
For other writes it permits retry only when the operation is retryable and
`not_started`. A known failure is not proof that repeating a write is safe.
Read operations may retry when marked retryable. Every command execution counts
as a write for this decision, even when its shell text appears read-only.
The caller must honor any retry delay and perform reconciliation through a
provider-supported status/idempotency mechanism. No such mechanism is invented
by core, and no exactly-once guarantee is implied.

## Protocol versions and optional fields

Version 1 capability descriptors reject unknown fields, unsupported capability
names and invalid numeric limits. Unknown protocol versions fail validation.
Optional fields may be omitted; core preserves the distinction between missing
information and an explicit unsupported operation. Adding a field requires a
core/adapter update that recognizes it; do not send future fields to older code.

Extension declarations now accept `version: 1`, with omission meaning version 1
for existing registrations. Unknown versions and fields fail registration.
Argument and return declarations must be required Convex validators; optional
members belong inside an object validator. These rules validate declarations,
not execution permissions. Extension execution remains unavailable until a
capability-checked, authorized dispatcher is implemented. A breaking extension
payload needs a new provider-namespaced extension name or a future protocol
version with an explicit compatibility decision. All of these APIs remain
experimental before 1.0.
