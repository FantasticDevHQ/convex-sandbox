# Native desktop session contract

`DesktopSession`, `DesktopSessionAdapter`, and `normalizeDesktopSession` are public
core exports. `getDesktopSession` is an explicit capability, separate from
`getConnection`. This change declares the native contract only. Boat transport and
shared dispatch belong to CSB-57, and the local human viewer belongs to CSB-66.
The Boat adapter does not yet advertise or dispatch this capability.

A validated session has this shape:

```ts
{
  kind: "desktop",
  url: "https://desktop.example/stream.html#token=synthetic",
  connectionWindow: { durationMs: 600000, basis: "provider-issued" },
  activeStream: "may-outlive-connection-window",
  disconnect: "no-revocation-guarantee"
}
```

`connectionWindow.durationMs` describes the documented initial connection window
from provider issuance. It is not a deadline calculated at client receipt, a
remaining-time guarantee, or a stream expiration. Validation does not refresh that
window. Consumers must request fresh access on page load or reconnect, rather than
reuse an old URL based on local arithmetic. An established stream may continue
past the window. The provider controls its actual lifetime. Removing an iframe or
disconnecting the client does not prove native token revocation.

There is deliberately no `expiresAt`. `normalizeDesktopSession` rejects that field,
unsupported lifetime assertions, unsafe URLs, and unknown response fields. Errors
omit the raw response and bearer URL. Normalization creates a fresh projection,
including the nested window. It does not authenticate, contact the provider, prove
readiness or ownership, or check whether a URL still accepts connections.

The API key belongs only in trusted server actions. Authorize exact scoped machine
ownership before native dispatch. Return the bearer URL only to the authorized
viewer, keep it ephemeral, and exclude it from durable component records, reactive
queries, logs and analytics. The session contract has no persistence/store API.
The existing observation projection continues to exclude incidental native URLs.

`getConnection` retains its separate strict contract. Its URL still needs native
expiration within the requested deadline. A desktop session cannot pass that
validator. The connection window must never be substituted for access expiration.

## Pinned Boat references

Reviewed 2026-11-09 through read-only public documentation requests, with no native
API calls. SHA-256 values identify the exact fetched bytes; these mutable upstream
URLs may later return different content.

| Source                                                                                               | SHA-256 / version                                                                                                        | Relevant contract                                                                                                                               |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [Embed the desktop and secure its URL](https://docs.boat.dev/desktop-streaming/urls-and-security.md) | `720e7899f4bd7c286b28e4315204792b93066ff20cdbd620eaf08bf497a41012`                                                       | Initial connection within ten minutes; established stream continues; reload/reconnect after window requires fresh URL; sandbox stop ends stream |
| [Boat OpenAPI](https://docs.boat.dev/openapi/boat-v1.yaml)                                           | `05c8754c6ed40b149749f5bd7bcf9cd8897ba9215ff80076fa7721a7e6ff352c`                                                       | `POST /sandboxes/{sandboxId}/desktop`, operation `desktop`, response `DesktopResponse`                                                          |
| Official SDK                                                                                         | `@boatdev/sdk@1.13.0`, exact integrity in [source inventory](boat/decision.md#source-and-license-inventory) and lockfile | Existing pinned adapter dependency; not upgraded or called here                                                                                 |

The OpenAPI `DesktopResponse` combines `SuccessBase` with an object allowing
additional properties. Its declared fields are `type`, `success`, nullable
`desktopUrl`, nullable `ip`, `mode`, `provisioning`, and `message`. It declares no
expiry timestamp or token revocation field. A provisioning response is not a
ready session. The schema also covers VNC; the ten-minute streaming documentation
must not automatically qualify every mode. Mode-specific mapping is CSB-57 work.

The source inventory retains the SDK MIT metadata and upstream attribution rules.
No upstream implementation or documentation text is copied into the package by
this change. Public docs and OpenAPI are referenced, not vendored; no additional
license grant for those reference documents is assumed.

## Acceptance traceability

| Requirement | Criterion | Execution                                                                                                                                             |
| ----------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-001     | AC-001    | `tests/client/desktop-session.test.ts`, lifetime semantics and malformed/misleading result rejection                                                  |
| REQ-002     | AC-002    | Same test file, existing expiry regression; `tests/images.test.ts` and `tests/boat/connections.test.ts` retain shared/Boat behavior checks            |
| REQ-003     | AC-003    | `tests/package.test.mjs`, extracted/installed tarball consumer imports types and runtime exports, strict typechecks, and rejects invented `expiresAt` |

These deterministic checks establish contract behavior and package availability.
Native lifetime qualification remains CSB-60 and requires separate live approval.
