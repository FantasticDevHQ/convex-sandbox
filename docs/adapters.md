# Adapter development

Adapters run in trusted Convex host actions. The component stores serializable registry, operation and execution state; it never stores SDK instances or executes a provider SDK on your behalf. A provider integration should wrap existing APIs and reuse upstream components where appropriate. It should not recreate a provider's agent runtime, Git tooling or snapshot service.

## Start with a truthful capability set

This complete example wraps an illustrative SDK shape. It supports describe only and is not a Boat, E2B or Daytona implementation. The host constructs `NativeClient` using server-owned SDK configuration before calling `exampleProvider`.

```ts convex/example-provider.ts
import {
  registerProvider, SandboxProviders,
  createLifecycleStore, createExecutionStore, createFileStore, createImageStore,
} from "@fantastic.dev/convex-sandbox";
import { createHostAccess, protectExecutionStore } from "@fantastic.dev/convex-sandbox/server";
import type { ActionCtx } from "./_generated/server.js";
import { components } from "./_generated/api.js";

interface NativeClient {
  getMachine(id: string, options: { signal?: AbortSignal }): Promise<{ id: string; status: string }>;
}
export function exampleProvider(sdk: NativeClient) {
  return registerProvider({
    name: "example",
    capabilities: { version: 1, supported: ["describe"] },
    adapter: {
      describe: async (providerId, context) => {
        const result = await sdk.getMachine(providerId, { signal: context?.signal });
        const state = result.status === "ready" ? "running"
          : result.status === "off" ? "stopped" : "unknown";
        return { providerId: result.id, state };
      },
    },
  });
}
export function hostClients(
  ctx: ActionCtx,
  access: ReturnType<typeof createHostAccess>,
  sdk: NativeClient,
) {
  const providers = new SandboxProviders({
    authorize: access.authorize,
    authorizeCreate: access.authorizeCreate,
  });
  providers.register(exampleProvider(sdk));
  return {
    lifecycle: providers.lifecycle(createLifecycleStore(ctx, components.sandbox)),
    execution: providers.execution(protectExecutionStore(createExecutionStore(ctx, components.sandbox))),
    files: providers.files({ ...createFileStore(ctx, components.sandbox), authorizePath: access.authorizePath }),
    images: providers.images(createImageStore(ctx, components.sandbox)),
  };
}
```

Construct `access` per request with verified auth, membership/resource permissions, stored binding lookup, server-owned provider selection and file policy. The example's describe capability enables observation of an already authorized binding. Other methods remain unsupported even though clients are returned. A callback that always allows access is only suitable for an internal synthetic test. See [host security](security.md).

## Wire credentials in the host

Read provider secrets from backend deployment configuration and pass them to the SDK constructor inside the trusted backend. Register that configured adapter in the action before constructing operation clients. Never accept an SDK URL, master key, provider selector or scope from the browser. Do not put provider credentials in `VITE_*`, command environments, guest files, operation records or error strings. Protected execution stores withhold text by default; enable reviewed redaction/allowlists deliberately.

Fetch-compatible SDKs can stay in Convex's default runtime. A Node-only SDK belongs in a separate action module with `"use node"` as its first statement, and may require its package to be configured as an external Node dependency. Keep queries/mutations/schema in default-runtime modules. This library has no mandatory Node-only provider SDK and does not require keys for unregistered providers.

## Add operations without inventing guarantees

| Operation area | Adapter obligation | Reference |
| --- | --- | --- |
| Create/lifecycle | Project native state/resources; declare create idempotency; use stable context keys and read-only lookup for recovery | [Lifecycle](lifecycle.md) |
| Execution | Implement start/status with explicit idempotency; preserve native command identity; optional find/cancel/logs | [Execution](execution.md) |
| Files | Enforce host path policy before SDK dispatch; honor byte/page bounds and native transfer directions | [Files](files.md) |
| Images/connections | Preserve provider-native image/job identity, pending readiness, connection kinds and expiry | [Images](images.md) |
| Provider-specific features | Use namespaced, validated extensions rather than untyped shared options | [Contracts](contracts.md) |

Advertise only operations the registration implements. Native idempotency is a provider property, not an exactly-once promise from this component. A lost create/execute reply remains unknown until a reliable native lookup or explicit operator resolution establishes the outcome. Do not retry a command to discover whether it ran. Missing lookup support is an explicit limitation.

Stop, delete, disk retention, memory suspension and image retention are separate semantics. Stop never substitutes delete. A stopped VM does not imply preserved RAM; memory resume requires its own capability. Unknown persistence is not retained persistence. Native images do not imply cross-provider portability, tenant isolation or a wall-clock retention guarantee.

## Test before enabling live mode

Use the [conformance kit](testing.md) with a new isolated fixture per case, then add provider-specific disposable live checks and cleanup. Baseline conformance is simulated; it does not certify a live VM, desktop stream, security boundary or billing behavior.

A future example integration must register the real adapter on the server, derive provider/account selection from verified application policy, expose only its declared capabilities, and implement explicit live opt-in and resource cleanup. Do not add a browser key field or present an unconfigured provider as working. Use a fresh disposable provider resource for tests. Provider integrations and storage work have their own [roadmap entries](integrations.md).
