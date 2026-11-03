import type { ConnectionHandle, ConnectionKind } from "../images.js";
import { hasControls } from "./fileProtocol.js";

export function normalizeConnection(
  raw: ConnectionHandle,
  kind: ConnectionKind,
  deadline: number,
): ConnectionHandle {
  const invalid = (): never => {
    throw new Error("Invalid connection handle");
  };
  if (
    !raw ||
    typeof raw !== "object" ||
    raw.kind !== kind ||
    typeof raw.url !== "string" ||
    raw.url.length > 16384 ||
    hasControls(raw.url) ||
    raw.url.trim() !== raw.url ||
    !Number.isSafeInteger(raw.expiresAt) ||
    raw.expiresAt <= Date.now() ||
    raw.expiresAt > deadline
  )
    return invalid();
  let url: URL;
  try {
    url = new URL(raw.url);
  } catch {
    return invalid();
  }
  if (
    !(
      kind === "ssh"
        ? ["ssh:"]
        : kind === "desktop" || kind === "browser"
          ? ["https:", "wss:"]
          : ["https:"]
    ).includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    !raw.access ||
    !["public", "token", "headers", "ssh-key", "provider-session"].includes(
      raw.access.kind,
    )
  )
    return invalid();
  const access: ConnectionHandle["access"] = { kind: raw.access.kind };
  if (raw.access.kind === "token") {
    if (
      typeof raw.access.token !== "string" ||
      !raw.access.token ||
      raw.access.token.length > 8192 ||
      hasControls(raw.access.token)
    )
      return invalid();
    access.token = raw.access.token;
  } else if (raw.access.token !== undefined) return invalid();
  if (raw.access.kind === "headers") {
    if (
      !raw.access.headers ||
      typeof raw.access.headers !== "object" ||
      Array.isArray(raw.access.headers)
    )
      return invalid();
    const entries = Object.entries(raw.access.headers);
    if (!entries.length || entries.length > 16) return invalid();
    const headers: Record<string, string> = {};
    let size = 0;
    for (const [key, value] of entries) {
      if (
        key.length > 256 ||
        !/^[!#$%&'*+.^_`|~\da-z-]+$/i.test(key) ||
        typeof value !== "string" ||
        value.length > 16384 ||
        hasControls(value)
      )
        return invalid();
      size += key.length + new TextEncoder().encode(value).byteLength;
      if (size > 16384) return invalid();
      Object.defineProperty(headers, key, { value, enumerable: true });
    }
    access.headers = headers;
  } else if (raw.access.headers !== undefined) return invalid();
  if (kind !== "ssh" && raw.access.kind === "ssh-key") return invalid();
  let username: string | undefined;
  if (raw.username !== undefined) {
    if (
      kind !== "ssh" ||
      typeof raw.username !== "string" ||
      !/^[a-z_][a-z\d_.-]{0,127}$/i.test(raw.username)
    )
      return invalid();
    username = raw.username;
  }
  return {
    kind,
    url: raw.url,
    expiresAt: raw.expiresAt,
    access,
    ...(username === undefined ? {} : { username }),
  };
}
