# Boat consumer setup and authenticated host

The adapter is experimental and not live-qualified. The component remains an
unpublished private candidate; use the repository/candidate installation flow
before copying this consumer example. The runnable TanStack Router playground is
explicitly simulated and gains no live provider switch from this guide.

Mount the component and generate your app's bindings as in the
[quickstart](../quickstart.md), then install the audited optional peer:

```sh
pnpm add @boatdev/sdk@1.13.0
```

Set BOAT_API_KEY and an optional BOAT_ORG through your backend deployment's secret
configuration. Do not put them in browser build variables, frontend code, action
arguments, guest environments, reactive records or logs. The default organization
is personal; select another wallet only through trusted server configuration.
Core/simulator consumers require neither the SDK nor a provider key.

## Checked read-only consumer example

This complete module reads an existing host-authorized binding. It does not create
or import a machine, register a webhook, install credentials or grant desktop
access. Bind machines through separately authorized creation/admission code.
Configure Convex authentication first. The example uses one namespace per verified
identity; organization/shared-resource apps must resolve verified membership and
permissions instead. This is a sample host policy, not a consumer topology imposed
by the component.

The browser sends only a logical key. Scope comes from verified identity and the
physical provider ID comes from the component binding. Missing authentication or
ownership is rejected before reading provider configuration. Missing Boat config
is explicitly unsupported, never a simulated success or silent live fallback.
The cached query never instantiates the provider or reads the API key. Only the
owner's refresh action uses it, and both wrappers return projected registry DTOs.

```ts convex/boat-host.ts
import { v } from "convex/values";
import { action, query, type ActionCtx } from "./_generated/server.js";
import { components } from "./_generated/api.js";
import {
  createLifecycleStore,
  registryRecordValidator,
  SandboxProviders,
  SandboxProviderError,
} from "@fantastic.dev/convex-sandbox";
import {
  createHostAccess,
  withSandboxErrors,
} from "@fantastic.dev/convex-sandbox/server";
import { createBoatProvider } from "@fantastic.dev/convex-sandbox/boat";

function accessFor(ctx: Pick<ActionCtx, "auth" | "runQuery">) {
  return createHostAccess({
    authenticate: async () => {
      const identity = await ctx.auth.getUserIdentity();
      return identity
        ? { subject: identity.subject, scope: identity.tokenIdentifier }
        : null;
    },
    getSandbox: sandbox =>
      ctx.runQuery(components.sandbox.registry.get, { sandbox }),
    authorize: ({ principal, sandbox, reference, operation }) =>
      principal.scope === sandbox.scope &&
      reference?.provider === "boat" &&
      (operation === "get" || operation === "describe"),
  });
}

export const cached = query({
  args: { key: v.string() },
  returns: registryRecordValidator,
  handler: (ctx, args) => withSandboxErrors(() => accessFor(ctx).get(args)),
});

export const refresh = action({
  args: { key: v.string() },
  returns: v.union(v.null(), registryRecordValidator),
  handler: (ctx, args) => withSandboxErrors(async () => {
    const access = accessFor(ctx);
    const { sandbox } = await access.resolve(args, "describe");
    const apiKey = process.env.BOAT_API_KEY;
    if (!apiKey) {
      throw new SandboxProviderError({
        code: "unsupported",
        capability: "describe",
        outcome: "not_started",
        retryable: false,
      });
    }
    const providers = new SandboxProviders({ authorize: access.authorize });
    providers.register(createBoatProvider({
      apiKey,
      org: process.env.BOAT_ORG ?? "personal",
    }));
    return providers.lifecycle(
      createLifecycleStore(ctx, components.sandbox),
    ).refresh(sandbox);
  }),
});
```

The checked module is documentation, not a mounted live endpoint in this repo's
playground. Tests compile and execute this exact fence with fake identity,
component bindings, server configuration and injected synthetic HTTP. They reject
anonymous/foreign callers and extra authority arguments, verify no-config failure,
and check that the key and native URLs never appear in owner results.
A server-only export guard is additional protection, not a substitute for auth.

## Dated capability matrix

Every row below was reviewed on 2026-11-04 against the exact SDK 1.13.0 and
[OpenAPI source](https://docs.boat.dev/openapi/boat-v1.yaml), SHA-256 recorded in the
[source inventory](decision.md#source-and-license-inventory). Source names identify
native operations or schemas in that dated artifact; this does not assert behavior
of an unreviewed future release. See the detailed [setup](setup.md) for semantics.

| Capability | Adapter behavior or explicit limitation | Dated native source |
| --- | --- | --- |
| create | Safe private no-env defaults, host size/TTL and bounded native idempotency key; no inferred lookup | 2026-11-04: create / CreateSandboxRequest |
| describe | Project known state/CPU; omit incidental URLs, errors and unsupported resource values | 2026-11-04: get / Sandbox |
| start | Disk resume; preserve size, noEnv and finite TTL; acceptance stays starting | 2026-11-04: resume |
| stop | Nonforced native stop with persisted job; disk retention unknown, RAM discarded | 2026-11-04: stop / getStop |
| delete | Confirmation header and matching completed native deletion job, never 404 alone | 2026-11-04: deleteSandbox / getDeletionOperation |
| execute | Detached history ID, literal argv mapping; env and detached runtime timeout unsupported | 2026-11-04: command / getCommand |
| cancelExecution | Unsupported: PID-only DELETE lacks atomic command identity precondition | 2026-11-04: stopCommand |
| executionLogs | Bounded exact-byte history offsets; UTF-8 boundaries, explicit gaps and cache limits | 2026-11-04: commandLogs / CommandLogsResponse |
| readFile | Whole-file base64 capped at 64 KiB, with local bounded offset slicing | 2026-11-04: readFile / FileReadResponse |
| writeFile | Native base64 write capped at 64 KiB with matching path/size confirmation | 2026-11-04: writeFile / FileWriteResponse |
| listFiles | Bounded one-level list; partial without fake cursor; host child path policy | 2026-11-04: listFiles / FileListResponse |
| deleteFile | Native nonrecursive delete; provider roots rejected | 2026-11-04: deleteFile |
| transferFile | Unsupported: native expiring GET/PUT URLs have no enforced byte limit | 2026-11-04: createDownloadUrl / createUploadUrl |
| listTemplates | Bounded source-scoped saved-name catalog; native names remain mutable | 2026-11-04: listSavedSnapshots / SavedSnapshot |
| createTemplate | Unsupported: no immutable save-generation/job identity while pending | 2026-11-04: saveSavedSnapshot / SavedSnapshotSavingResponse |
| createFromTemplate | Unsupported in this entry; no unverified selection/ownership mapping | 2026-11-04: create / CreateSandboxRequest.from |
| fork | Persist distinct child ID before read-only readiness; source is not rebound | 2026-11-04: fork / get |
| restore | Unsupported: recover power-cycles; create-from-image changes identity | 2026-11-04: recover / create |
| snapshotDisk | Unsupported: background/stop capture is not an explicit correlated capture | 2026-11-04: saveSavedSnapshot / listSandboxSnapshots |
| suspendMemory | Unsupported; native stop discards running processes/RAM | 2026-11-04: stop / resume semantics |
| resumeMemory | Unsupported; disk resume is not RAM restore | 2026-11-04: resume semantics |
| getConnection | Unsupported: no established native enforced expiry for any common kind | 2026-11-04: desktop / hostPort / sshKey; browser mapping unestablished |

## Lifetimes, recovery and cleanup

Auto-stop is a deadline, not idle detection or credential expiry. Native activity
can extend archiveAfter; it does not create a short-lived connection grant.
[Connection limits](connections.md) and [direct transfer limits](setup.md#bounded-inline-files)
remain explicit. Stop discards RAM/processes; disk retention depends on native
snapshot/account policy and is advertised unknown. No memory restoration or
cross-provider image portability is promised.

Lost command/create/fork replies remain unknown without mutation replay. Keep
stable operation IDs while retained and use read-only shared status/reconciliation.
The host owns its bounded scheduling/backoff policy; the component installs no
agent loop or settle scheduler. See [reconciliation](reconciliation.md).

The host must track approved disposable resources, resolve unknown outcomes and
clean up verified native IDs. A fork does not automatically register a destination
or clean up orphaned children. Native saved images can outlive their source;
confirmed sandbox deletion does not establish artifact deletion. This API adds no
snapshot retention cleanup or discovery-by-name recovery. Live verification and
publication remain separately gated; this guide executes neither.

Managed agents, Pi/runtime installation, Git workflows, desktop topology, user
profiles, bucket mounts and durable external storage are separate concerns. Do not
add those systems merely to use this provider abstraction. The playground remains
a [local simulator](../../example/README.md) with synthetic state, even if an
ambient Boat configuration is present; no working live option is advertised.
