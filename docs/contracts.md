# Common contracts

These pre-1.0 contracts are experimental. Provider integration projects may refine
them before release. The current dispatcher implements `describe` only. Lifecycle,
execution and operation tracking have types here, but their dispatch and persistence
arrive in later baseline work.

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
status is pending, running, succeeded, failed or cancelled. `LifecycleResult` adds
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
without automatic retry. Capability discovery and normalized error/retry semantics
are separate baseline work.

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
no extension execution method yet. Capability discovery and authorization-gated
extension dispatch must land before extensions can run through the common layer.
The core never exposes an arbitrary SDK-method escape hatch.

The older `SandboxBoundary` remains the narrow observation proof. Its host must
authorize before calling it; new provider contracts use `SandboxProviders` with
its required authorization callback. Neither registry persists state by itself.
