# Host authorization and credential boundaries

The component's functions are called by a trusted application backend. They are not an authentication service. The application must authenticate each caller, resolve active account membership, check resource permissions and keep provider SDK configuration on the server. The low-level adapter clients remain available for trusted code; installing this component does not secure an arbitrary public wrapper automatically.

Import the composable helpers from `@fantastic.dev/convex-sandbox/server`. Browser resolution selects an entry that rejects the import. Convex resolution uses the explicit `convex` package condition; Node uses the default server entry. Do not re-export backend SDK/configuration modules through frontend/shared modules. Package conditions cannot stop an application from copying a secret into its own browser code.

## Resolve authority from the host

`createHostAccess` requires trusted `authenticate`, `getSandbox` and `authorize` callbacks. It does not depend on an auth vendor. `authenticate` must return `{ subject, scope }` from verified identity and server-checked membership. Never copy an owner/scope from request arguments or treat an unverified browser-selected account as authenticated membership.

```ts
const access = createHostAccess({
  authenticate: () => resolveVerifiedMembership(ctx),
  getSandbox: sandbox => ctx.runQuery(components.sandbox.registry.get, { sandbox }),
  listSandboxes: (scope, page) => ctx.runQuery(components.sandbox.registry.list, {
    scope,
    paginationOpts: { cursor: page.cursor, numItems: page.limit },
  }),
  authorize: permission => applicationResourcePolicy(ctx, permission),
  selectProvider: (principal, key) => configuredProviderFor(principal, key),
  authorizePath: request => applicationFilePolicy(ctx, request),
});
const providers = new SandboxProviders({
  authorize: access.authorize,
  authorizeCreate: access.authorizeCreate,
});
// Register adapters here from trusted server configuration, never request data.
```

`resolveVerifiedMembership`, `applicationResourcePolicy`, `configuredProviderFor` and `applicationFilePolicy` above are application-owned policies, not built-in allow rules. The application must implement them using its authentication and permission data. Authentication is evaluated on each call rather than caching a principal in a module-global session. Construct helpers within the query/action and do not carry identity between requests.

`access.resolve({ key }, operation)` returns the server-resolved sandbox identity and stored provider reference after authorization. `access.get({ key })` returns projected registry metadata. Both reject additional input fields, including `scope`, `owner`, `provider`, `providerId`, credentials and path-policy overrides. Operation names are server literals, not browser permission claims.

The provider callbacks independently re-check authenticated scope, resource permission and the stored physical reference immediately before low-level dispatch. A fabricated provider/resource pair cannot grant access. They default to denial on failed permission checks. Tombstoned bindings allow historical metadata reads but reject native mutation/read dispatch through this policy.

`access.create({ key })` additionally requires `selectProvider`; provider selection comes from that trusted callback. `authorizeCreate` verifies that SDK creation uses the same scope and selected provider. It does not accept a browser-supplied provider configuration. Register SDKs using deployment secrets in backend modules. Never pass master keys into guest command environments, component arguments, callback results or frontend environment variables.

`access.list({ cursor, limit })` authenticates and fixes the component query's scope, limits pages to 1..100, rejects foreign-scope rows and filters resources denied by the application policy. `partial` marks filtered/clipped pages. A host pagination callback must preserve the component cursor/query scope and return registry DTOs, not provider SDK objects.

## Authenticated action pattern

A public host action should use object-form args/return validators and accept only operation data:

```ts
export const execute = action({
  args: { key: v.string(), operationId: v.string(), input: commandInputValidator },
  returns: executionRecordValidator,
  handler: (ctx, args) => withSandboxErrors(async () => {
    // Application factory wires the policies and registers server-owned adapters.
    const { access, providers } = createApplicationSandboxServices(ctx);
    const { sandbox } = await access.resolve({ key: args.key }, "execute");
    const execution = providers.execution(
      protectExecutionStore(createExecutionStore(ctx, components.sandbox)),
    );
    return execution.start({ sandbox, operationId: args.operationId, input: args.input });
  }),
});
```

`createApplicationSandboxServices` is the application's factory around the first example. Do not spread browser args into SDK registration or service configuration. For get/list/delete/file/connection wrappers, use the corresponding server operation and these same callbacks. Component references, SDK objects and callbacks must never be public RPC arguments.

## Files and secret handles

Use `access.authorizePath` as the file client's mandatory path policy. It repeats the binding/permission check, canonicalizes the path and then invokes the server's file policy. With no configured file policy, every path is denied. A browser cannot supply or override the callback. Lexical checks still require native symlink containment; see the [file guide](files.md).

Connection and direct-transfer handles belong only in authenticated owner action responses. Pass normalized native handles through `protectSecretHandle(handle, masterKeys)` before returning them; this rejects configured master-key values and their URL-encoded forms and snapshots the handle. Use deployment secret values here, not credentials supplied by the browser. This is an accidental-exposure guard, not detection of arbitrary encrypted/encoded secrets. Adapters must issue scoped, short-lived native credentials with the expiry/access semantics documented in the [image guide](images.md).

Never put signed URLs in registry records, template metadata, operation IDs, pagination cursors, logs or reactive lists. Native IDs/cursors must be nonsecret. Host callbacks must not forward raw SDK objects to component RPC. File content is intentionally returned to authorized owners; enforce a narrow path policy and any application content policy before exposing it.

## Output and error policy

`protectExecutionStore(store)` defaults to retaining **no text**. It removes inline stdout/stderr and log-page text before component writes and withholds text when reading older caches. Truncation markers indicate withheld/changed output. Execution state, exit codes and cancellation still work. Apply this wrapper to every execution read/write path; mixing protected and unprotected stores defeats the policy.

Opt-in retention requires an explicit server redactor:

```ts
protectExecutionStore(store, {
  retention: "redacted",
  secrets: providerMasterKeys,
  redact: text => /^progress: \d{1,3}%$/.test(text) ? text : "[redacted]",
});
```

Built-in sanitization removes configured literal secrets, HTTP/WebSocket/SSH URLs and bearer values before and after the callback. It bounds output and uses nonrecursive secret replacement. Limits are 64 configured secrets, 4096 characters each and 65536 aggregate characters. A secret-bearing provider log cursor fails closed rather than being persisted or rewritten into an invalid native cursor.

Literal redaction is not a detector for arbitrary sensitive output, private conversations, partial secret fragments, or secrets split across provider chunks. Keep the default no-text policy unless the application can approve a safe output allowlist. Redactor failures withhold content. Redacted text remains subject to the component's existing 4 KiB chunk, 64 KiB execution and 100-operation history limits. There is no wall-clock retention TTL or automatic purge of pre-existing raw caches; existing content remains in storage until the host deletes it or normal bounded history cleanup evicts it. Read-time filtering is not deletion.

Use `withSandboxErrors` around public wrappers, or `serializeSandboxError` for safe structured logging. Only fixed provider error codes, outcome, retryability and optional capability survive. Raw messages, SDK `providerCode`, causes and stacks are omitted. Helpers do not log raw SDK data. SDK-specific verbose logging and application log sinks must follow the same policy; passing a raw error to another logger bypasses this boundary.

## Fixture scope

The example contains only internal synthetic proof actions with fixed fixture identities. They exercise foreign-scope get/execute/file/connection/delete denials, reject list-scope injection, verify no unauthorized SDK calls, and verify no output/master-key retention. No public identity selector, production authorization, real provider credentials, guest shell command or live sandbox is used. An application needs its own verified membership and permission policies before exposing sandbox operations publicly.
