# Native images and connections

These APIs wrap native provider features in trusted host actions. They install no guest runtime, stream server or desktop router. `ImageReference` contains a provider, an opaque native ID and a kind of `template` or `disk-snapshot`. It is not a portable artifact, external user-data backup or promise of memory preservation.

## Capabilities and creation

Providers advertise `listTemplates`, `createTemplate`, `snapshotDisk`, `fork`, `restore` and `getConnection` independently. Lifecycle creation with `options.templateId` additionally requires `createFromTemplate` and `create`; the ID belongs to that selected provider. A provider must not advertise an operation unless its native API implements those semantics. A missing SDK method or connection kind fails as unsupported. The core never substitutes stop, memory suspension, a different image operation or another provider.

Register optional `adapter.images` and `adapter.connections` implementations with `SandboxProviders`. Use its existing `authorize` callback to authenticate the caller and check ownership. The host must authorize each operation, including image mutation, template listing, status lookup and issuing a connection. Lifecycle creation continues to use `authorizeCreate`.

```ts
const images = providers.images(createImageStore(ctx, components.sandbox));
const operation = await images.run({
  sandbox,
  operationId: "unique-snapshot-request",
  kind: "snapshotDisk",
});
// Return the handle immediately. A later action can check native readiness.
const latest = await images.status({ sandbox, operationId: operation.operationId });
```

## Durable native jobs

`run` supports four explicit kinds:

| Kind | Native result when ready |
| --- | --- |
| `snapshotDisk` | A `disk-snapshot` reference from the same provider |
| `createTemplate` | A `template` reference from the same provider |
| `fork` | A new machine's provider reference, from the same provider |
| `restore` | Confirmation of restoring the bound machine from the supplied same-provider `image` |

Restore requires `image`; other operations reject it. Fork returns a physical identity. It does not create an application key or rebind the source. The host must authorize and bind any destination identity, and manage orphaned native resources. Restore must target the existing provider ID; an adapter must not silently recreate or switch the machine. Native image compatibility and permission checks remain provider responsibilities.

Admission and a one-shot dispatch claim use the shared sandbox operation state. The record's optional `nativeImage` metadata contains only source/result identifiers, the provider job ID and temporary lease mode. Operation `pending` means reserved but not dispatched, `running` means dispatched or still pending natively, `succeeded` means the native API confirmed ready, and `failed`/`unknown` retain their existing meanings. A native failure releases the active operation. An unknown outcome remains active until read-only reconciliation confirms a terminal result.

Duplicate IDs do not dispatch twice while their operation is retained. Status uses a native job ID or the adapter's optional **read-only** `find` correlation lookup. Missing lookup results never authorize another mutation. A crash before publication retains the claim; after its lease expires, status may look up the job without repeating the mutation. Status queries cannot claim a reserved, never-started request. Expired leases, stale versions and changed machine generations reject late publication. Ordinary lifecycle/generic operation transitions cannot bypass this protocol.

SDK requests have a five-second deadline and abort signal. That does not cancel a native snapshot job or prove it did not start. There is no background polling scheduler: the host decides when to call `status`. Ready restores leave machine observation stale; use lifecycle observation to learn its current state. No running state or memory guarantee is inferred from disk readiness.

Records share the bounded 100-operation history per sandbox. Completed handles can expire; do not replay expired mutation IDs. `get` reads authorized cached metadata without polling. The action helpers require a live current binding; host-authorized component operation queries can read retained historical metadata. Artifact deletion/retention, image portability, memory snapshots, native-job cancellation and storage lifecycle policies are outside this API.

## Template catalog

`listTemplates({ sandbox, cursor, limit })` authorizes against an existing bound machine, then calls that provider's native catalog. This initial API does not provide a provider-global catalog before any machine exists. Pages contain projected references and `pending`/`ready`/`failed`/`unknown` readiness, an opaque nonsecret cursor and `partial`. Default page size is 50, maximum 100. SDK extras such as URLs and credentials are discarded. Native cursors must not carry credentials; use authenticated action results rather than broad provider catalogs when native account visibility is wider than the application scope.

## Connection handles

```ts
const handle = await images.connection({
  sandbox,
  kind: "desktop",
  expiresInMs: 60000,
});
```

Kinds are `preview`, `ssh`, `desktop` and `browser`. Adapters declare supported kinds and return only what their native service offers. An optional port must be 1..65535. Handles contain kind, URL, expiration and an explicit access requirement: `public`, `token`, `headers`, `ssh-key` or `provider-session`. Token/header secrets are present only for their corresponding requirement. SSH keys and provider login sessions are external requirements; this API never generates or returns private SSH keys.

Preview URLs require HTTPS, desktop/browser URLs HTTPS or WSS, and SSH URLs the SSH scheme. URLs cannot contain userinfo or control characters. Expiration must be in the future and within the requested lifetime, default 60 seconds and maximum five minutes. Tokens and request headers are bounded and projected. Providers must enforce their claimed native access and expiration semantics; the core validates metadata, not remote revocation. A provider without an expiring native connection handle must leave that kind unsupported. Public access is allowed only when the host deliberately authorizes it.

Connection URLs and credentials remain action-local. Never persist or log them, return them from general reactive queries, or put them in operation/template metadata. Native signed URLs can be secret-bearing even when the access requirement is `public`. Return `connectionHandleValidator` only from an authenticated owner action. Readiness does not test network connectivity, launch a desktop or install missing services.

Public `imageReferenceValidator`, `imageSnapshotValidator`, `templatePageValidator`, `connectionHandleValidator` and the common `operationRecordValidator` support host RPC contracts. Actual provider SDKs and their integration qualification remain separate projects. The example's internal proof uses synthetic SDK responses only.
