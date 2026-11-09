# Boat connection compatibility

The experimental adapter advertises no getConnection capability and installs no
connection adapter. All four common kinds fail unsupported after host ownership
authorization, before any native setup or URL request. This is a deliberate result
of the pinned API audit, not a claim that Boat lacks desktop, port or SSH access.
No connection runtime or expiry proxy is added to compensate.

This audit covers SDK 1.13.0 and the OpenAPI digest recorded in the
[source inventory](decision.md#source-and-license-inventory), reviewed 2026-11-04.
It does not assert behavior of an unreviewed future SDK or undocumented endpoint.

| Common kind | Audited native surface | Contract limitation and adapter result |
| --- | --- | --- |
| desktop | POST /sandboxes/{id}/desktop; noVNC via vnc=1; DesktopRequest and DesktopResponse | desktopUrl can contain a bearer token. provisioning means setup is pending. No documented requested lifetime or enforced expiry is supplied. publicAccess can bypass token gating and does not add expiry. Unsupported; no desktop/VNC provisioning, polling or public-access request. |
| preview | POST /sandboxes/{id}/host; HostPortRequest and HostPortResponse | Opens the sandbox firewall and registers a stable hosted route. Repeated requests reuse the URL/token. Public or protected access is reported, but no documented lifetime or enforced expiry is supplied. Unsupported; no port registration, firewall change or token minting. |
| ssh | POST /sandboxes/{id}/sshkey; SshKeyRequest and SshKeyResponse; Sandbox.sshEndpoint | Installs an OpenSSH public key and returns host/user metadata, not an expiring access grant. Unsupported; no key generation, registration, SSH command or credential administration. |
| browser | No separate contract-compatible native browser connection was established | A desktop URL does not establish a distinct browser session or expiring CDP handle. Unsupported; no guessed port/URL, hosted-port fallback or guest command. |

The [shared connection contract](../images.md#connection-handles) requires native
access semantics and a future expiration within the caller's requested lifetime.
Caller expiresInMs is a request, not a remotely enforced deadline. Adding
Date.now() to it, copying a TTL, or recognizing a JWT-shaped token cannot establish
native expiry. Sandbox.archiveAfter is an auto-stop deadline that can move while
an agent works; it is not credential revocation. Stopping a VM or intending to
revoke access later does not turn its existing URL into a short-lived grant.
Do not substitute a scheduled cleanup, stable public URL or master account key.

Describe/refresh continue to project only the allowed machine state/resources.
Secret-bearing desktop/machine URLs, preview tokens, SSH metadata and incidental
browser fields are omitted from observations and durable component records.
Connection requests create no operation or bearer handle. Never return a raw SDK
Sandbox or DesktopResponse as a replacement for this boundary. Native connection
readiness also says nothing about independent users, desktops or browser profiles.
Those guest/runtime decisions are outside the component.

A future implementation must establish the native expiration and access contract
for each kind separately before advertising it. Native credentials and URLs must
remain action-local, never reactive or durable. The existing generic connection
validation and host authorization stay unchanged.

The deterministic tests in tests/boat/connections.test.ts check every kind's
no-dispatch result, host authorization order, unknown-kind rejection and safe
projection of synthetic secret-bearing observations. boatConnectionProof exercises
the same public factory/shared stores on owned anonymous and packed hosts. No live
Boat credentials, guest sessions or resources are needed for these fixtures.

## Separate native desktop sessions

The [native desktop-session contract](../desktop-sessions.md) records the updated
2026-11-09 documentation and API provenance. Its connection window allows an
established stream to continue and does not establish token revocation. It leaves
this strict expiring getConnection boundary intact. Boat implementation is CSB-57;
no native desktop capability is advertised by this contract-only change.
