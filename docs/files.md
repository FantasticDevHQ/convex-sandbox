# Bounded native files

File APIs run in trusted host actions. Register a native `adapter.files` implementation and advertise each implemented capability: `readFile`, `writeFile`, `listFiles`, `deleteFile`, `transferFile`. Missing methods or unsupported transfer directions fail before SDK dispatch. The core never falls back to shell execution.

```ts
const files = providers.files({
  ...createFileStore(ctx, components.sandbox),
  authorizePath: async ({ path }) =>
    path === "/workspace" || path.startsWith("/workspace/"),
});
const result = await files.readText({ sandbox, path: "/workspace/README.md" });
```

`providers` must authenticate and authorize sandbox ownership through its host `authorize` callback. `authorizePath` is a second, mandatory server policy, called for the canonical requested path and every returned directory child. Only `true` permits access. Do not accept either callback or a provider reference from browser arguments. Exported `fileReadValidator`, `fileTextReadValidator`, `fileWriteValidator`, `fileDeleteValidator`, `fileListValidator` and `fileTransferValidator` support authenticated host action return contracts.

Paths are absolute POSIX paths, at most 4096 characters. Dot segments, backslashes, controls, leading double slashes and encoded traversal/separator sequences are rejected; repeated interior slashes and trailing slashes are canonicalized. Adapters must treat these as literal filesystem paths without URL decoding. This is a lexical policy, not a symlink jail: provider permissions or a native root-contained file API must prevent symlinks escaping authorized roots. A provider without that guarantee must not expose untrusted file access. The core has no remote filesystem visibility to verify containment.

## Inline content

- `read`/`readText` accept `offset` and `maxBytes` (default 64 KiB, maximum 1 MiB). `write` accepts an `ArrayBuffer`; `writeText` encodes UTF-8. Writes are capped at 1 MiB before copying/encoding expensive data where possible. A smaller declared `limits.maxFileBytes` also applies; requests above it fail rather than silently increase a provider limit.
- Binary replies preserve bytes and copy only the returned typed-array view. Oversized native replies are clipped to the requested size. `bytesRead`, `truncated`, `nextOffset` and optional `totalBytes` make partial reads explicit. Empty incomplete replies are rejected.
- Text reads preserve a UTF-8 BOM and omit an incomplete final character on truncated pages. Continue at `nextOffset`; choose a byte limit of at least four for arbitrary UTF-8. Invalid encoding and limits too small to return the next character fail clearly. Offsets must be UTF-8 boundaries for text reads.
- `write`/`writeText` return `{ bytesWritten, partial }`; `delete` returns `{ deleted }`. Mutation requests require an `operationId`. It scopes the SDK idempotency key but creates no durable deduplication guarantee. No file operation automatically retries. An unknown write/delete outcome requires provider reconciliation before a caller decides to repeat it.
- `list` takes `cursor` and `limit` (default 50, maximum 100). Results contain projected name, canonical path, kind and optional size. `partial` marks incomplete, clipped or policy-filtered replies. `nextCursor` is an opaque, nonsecret provider pagination cursor, never a signed URL. Providers must return bounded pages and support their own pagination correctly; a clipped page without a usable cursor may require a narrower query.

Sandbox identity, reference and binary inputs are copied before async authorization. Registry bindings are checked again before SDK dispatch and before returning results. A changed generation or deleted/rebound machine rejects the result; mutations report an unknown outcome. These checks cannot atomically prevent a remote operation racing deletion. SDK calls have a five-second deadline and receive an abort signal; providers may continue work despite cancellation.

## Direct transfer handles

`transfer` requests a native `download` or `upload` handle with an explicit `operationId`. Adapters must declare supported `transferDirections`. Handles require HTTPS with no URL userinfo, a correct direction/method (`GET` for download, `PUT`/`POST` for upload), a future expiration within the requested lifetime (default 60 seconds, maximum five minutes), an enforced byte bound, and an explicit `partial` flag. Native credentials must actually enforce expiration and size; metadata alone does not restrict an upload. Providers unable to enforce those constraints must omit this capability/direction.

`maxBytes` defaults to 1 MiB, with a core ceiling of 1 GiB and the provider's smaller declared file limit. Optional `totalBytes` identifies known full size. Handles may carry bounded request headers; they are secrets, like signed URLs. Return them only from an authenticated owner action. Never log, cache in reactive queries, persist, or put them in general sandbox/file listings. The core validates and projects native metadata and never downloads/uploads URL content itself.

File contents and transfer handles stay action-local. The component stores only existing sandbox registry metadata. This API adds no bucket mounts, R2 bindings, sync jobs, storage identities or checkpoint system. External durable user storage is a separate project. The internal example proof uses only synthetic in-memory data; no real provider is claimed supported by it.
