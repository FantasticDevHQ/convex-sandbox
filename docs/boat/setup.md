# Experimental Boat observation adapter

The optional `@fantastic.dev/convex-sandbox/boat` entry currently implements
`describe` only. Provisioning, lifecycle mutations, commands, files, images and
connections remain unsupported. It is not a live-qualified provider release.
The playground continues to use the simulator.

Install the exact audited SDK alongside the component when using this entry:

```sh
pnpm add @boatdev/sdk@1.13.0
```

The SDK is an optional peer. Core and simulator consumers do not need it. Browser
imports of the Boat entry fail; the `convex` condition selects its server entry.
An import guard helps prevent accidental bundling and does not replace application
authorization or prevent credentials from being exposed by an unsafe host wrapper.

## Configure in the trusted host

Construct inside the action after authenticating and authorizing the caller. Read
the key from backend deployment configuration. The following is a fragment inside
an already authorized action, not a public endpoint or complete auth policy:

```ts
import { createBoatProvider } from "@fantastic.dev/convex-sandbox/boat";

const boat = createBoatProvider({
  apiKey: process.env.BOAT_API_KEY!,
  org: "personal",
});
// Register boat in the existing SandboxProviders configured with host authorization.
```

Use an existing provider binding authorized by the application. A provider ID,
wallet name, credential or tenant scope supplied by a browser is not authorization.
The factory does not query account credentials, import secrets into guests, or
change Boat's active organization. Configuration is captured at construction.
The default wallet scope is explicitly `personal`; set a host-approved organization
ID/name for another wallet. The fixed API origin is `https://boat.dev/api/v1`.

Never put the key in `VITE_*`, browser payloads, guest files/environments, registry
records, operation history or error strings. See [host security](../security.md).
Native Boat account permissions remain in force. `X-Boat-Org` scopes a wallet;
it does not create a per-user authorization boundary.

`fetch` may be supplied only by trusted host code for instrumentation/testing.
It must not replay mutations or log credentials. The adapter always injects fetch
into the SDK, disallows redirects, and excludes SDK retry/polling middleware.

## Bounds and errors

- Each adapter call has a five-second deadline, even when used directly without
  a shared lifecycle client. Caller aborts reach the HTTP signal and response
  reader. The returned promise settles even if a custom fetch ignores abort.
- Successful response bodies are capped at 1 MiB before SDK JSON decoding.
  Oversized or invalid observations fail safely. There is no claim that every
  future command/file method fits this response policy.
- HTTP error bodies are canceled without parsing. Shared codes are classified by
  status: 400/413/422 validation, 401 authentication, 402 quota, 403 authorization,
  404 stale resource, 429 rate limit, 408/504 timeout and 503 capacity. Unknown
  statuses and lost replies remain unknown outcomes. Raw provider messages,
  response bodies, URLs, causes and native error codes are not returned.
- Known request rejections have `not_started` outcome. A timeout, lost reply or
  ambiguous server/conflict response during a mutation does not prove that it
  failed to start. It remains unknown and is never automatically replayed.
  Retryability metadata is advice, not a retry loop. Retry-After hints and
  native error-body subcodes are not currently projected.
- Observation maps init/provisioning/provisioned/cloning to starting,
  ready/idle/running to running, archiving to stopping, archived to stopped,
  and error/cancelled to error. Future state strings map to unknown.
  Extra fields, error text and resource-size guesses are omitted.

The adapter adds no table, operation ledger, scheduler or recovery loop. Shared
registry and operation clients keep their existing ownership. A missing sandbox
is reported as stale rather than inferred to be confirmed deletion.

## Verification and next steps

`tests/boat/transport.test.ts` covers host configuration, projection, aborts,
deadline/body bounds, lost replies and safe status errors using injected fetch.
Package tests reject browser imports and block SDK resolution from core/testing.
The internal `boatProbe:transport` action uses the public entry with synthetic
fetch and runs on both owned anonymous Convex backends during qualification,
including the packed-package backend. No live credentials or Boat resources are
needed. Live qualification remains a separate explicitly budgeted gate.

See the [source and capability decision](decision.md) before adding operations.
