# Quickstart

The baseline is experimental and the package is not published to npm yet. Use the repository's example today; the package's public export paths below are the integration contract. Boat, E2B and Daytona are separate [planned integrations](integrations.md), not selectable live providers.

## Run the simulated playground

Use Node 22+ and pnpm 9.15.0:

```sh
git clone https://github.com/FantasticDevHQ/convex-sandbox.git
cd convex-sandbox
pnpm install --frozen-lockfile
pnpm worktree:setup
pnpm worktree:start --frontend
```

Open the printed frontend URL and choose Playground. Create demo machines, select `persistent`, run Hello, and read its recorded output. Try large output pagination, lost reply followed by Check execution, file write/read and stop/start. The memory profile pauses; ephemeral stop discards disk. Delete retains a tombstone; Reset demo data creates a new fixture epoch. The page always labels the adapter simulated: no VM, shell or compute is running. See the [full walkthrough](example-backend.md).

No provider keys, cloud development deployment or login is needed. First setup needs network access for dependencies/backend binaries and origin freshness. The local-only fixture is not production authentication. Worktree commands require committed source and own their state/processes. `pnpm worktree:stop` preserves data; teardown releases ports while preserving data; explicit `pnpm worktree:cleanup --yes` deletes only the owned disposable backend. See [development](development.md).

For a frontend without a backend, run `pnpm dev:frontend`. Playground shows setup instructions until a loopback backend is configured.

## Use the package in an existing Convex app

Until a registry release is verified, build and pack a local checkout:

```sh
pnpm build:lib
pnpm pack --pack-destination /tmp
```

From an existing Convex app with its own generated bindings, install the resulting tarball (replace the path with the printed filename):

```sh
pnpm add convex /absolute/path/to/fantastic.dev-convex-sandbox-0.1.0-rc.0.tgz
```

This uses the distribution artifact without importing private source. Keep production secrets and deployments out of the local example. After a release, use its published version instead; this guide does not claim that a registry version exists now.

Mount the component in `convex/convex.config.ts`:

```ts convex/convex.config.ts
import { defineApp } from "convex/server";
import sandbox from "@fantastic.dev/convex-sandbox/convex.config.js";
const app = defineApp();
app.use(sandbox);
export default app;
```

Run your app's normal Convex codegen/dev command to generate `components.sandbox`. In this repository, use managed anonymous setup and `pnpm codegen`; do not point example commands at an unmanaged deployment.

## Authenticate host queries

The component does not authenticate browser callers. Wrap component queries in your application's backend. This complete query uses verified Convex identity and a per-identity scope as an example policy; an application with organizations or shared resources should resolve verified membership and permissions instead. Scope strings impose no consumer topology.

```ts convex/sandboxes.ts
import { v } from "convex/values";
import { query } from "./_generated/server.js";
import { components } from "./_generated/api.js";
import { registryPageValidator } from "@fantastic.dev/convex-sandbox";
import { createHostAccess, withSandboxErrors } from "@fantastic.dev/convex-sandbox/server";

export const mine = query({
  args: {},
  returns: v.object({ ...registryPageValidator.fields, partial: v.boolean() }),
  handler: ctx => withSandboxErrors(async () => {
    const access = createHostAccess({
      authenticate: async () => {
        const identity = await ctx.auth.getUserIdentity();
        return identity ? { subject: identity.subject, scope: identity.tokenIdentifier } : null;
      },
      getSandbox: sandbox => ctx.runQuery(components.sandbox.registry.get, { sandbox }),
      listSandboxes: (scope, page) => ctx.runQuery(components.sandbox.registry.list, {
        scope, paginationOpts: { cursor: page.cursor, numItems: page.limit },
      }),
      authorize: ({ principal, sandbox }) => sandbox.scope === principal.scope,
    });
    return access.list({ limit: 20 });
  }),
});
```

Configure your app's authentication before calling this query. An unauthenticated request is denied. Mounting the component creates no machine; this list is empty until authorized host actions record resources through an adapter. Never accept a caller's scope, provider credentials or physical ID as authority. Add [trusted action wrappers](security.md) and [register an adapter](adapters.md) before enabling operations.

## Subscribe from the client

Use your host query's generated reference with Convex's normal provider/hooks. The following checked example uses the runnable repository's local-only `api.demo.list`; in an authenticated consumer use `api.sandboxes.mine` from the query above. Do not copy the demo's fixture identity into a deployed application.

```tsx src/sandbox-list.tsx
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api.js";
export function SandboxList() {
  const result = useQuery(api.demo.list, {});
  if (!result) return <p>Loading component records…</p>;
  return <ul>{result.page.map(row =>
    <li key={row.key}>{row.key}: {row.observedState}</li>
  )}</ul>;
}
```

The host action calls the SDK and persists projected results; the query subscription observes those component writes. Action return values are not a replacement for durable records. Keep SDK instances, callbacks, master keys and signed access handles out of component state. See the [API map](api.md) for clients, validators and operation semantics.

Every TypeScript fence in this guide and the adapter guide is compiled by `pnpm test:docs` against built public exports and actual example bindings. This checks SDK/type compatibility, not your app's auth policy or a live provider.
