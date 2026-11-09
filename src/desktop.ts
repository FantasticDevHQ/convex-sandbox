import { hasControls } from "./client/fileProtocol.js";
import type { ProviderCallContext } from "./lifecycle.js";

/** Ephemeral bearer access. Never persist, log, or include in reactive state. */
export interface DesktopSession {
  kind: "desktop";
  url: string;
  /** Documented relative window, starting at provider issuance, not receipt. */
  connectionWindow: {
    durationMs: number;
    basis: "provider-issued";
  };
  /** The connection window does not establish a stream termination deadline. */
  activeStream: "may-outlive-connection-window";
  /** Removing a viewer is not proof that its native token was revoked. */
  disconnect: "no-revocation-guarantee";
}

/** Trusted-action contract. Dispatch/authorization belongs to the host wrapper. */
export interface DesktopSessionAdapter {
  get(
    providerId: string,
    context: ProviderCallContext,
  ): Promise<DesktopSession>;
}

/** Validate semantics and snapshot an ephemeral result, without inventing expiry. */
export function normalizeDesktopSession(raw: unknown): DesktopSession {
  const invalid = (): never => {
    // Never include the raw URL or response in an error.
    throw new Error("Invalid desktop session");
  };
  const object = (
    value: unknown,
    keys: readonly string[],
  ): value is Record<string, unknown> =>
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => keys.includes(key));
  if (
    !object(raw, [
      "kind",
      "url",
      "connectionWindow",
      "activeStream",
      "disconnect",
    ]) ||
    raw.kind !== "desktop" ||
    typeof raw.url !== "string" ||
    !raw.url ||
    raw.url.length > 16384 ||
    raw.url.trim() !== raw.url ||
    hasControls(raw.url) ||
    !object(raw.connectionWindow, ["durationMs", "basis"]) ||
    !Number.isSafeInteger(raw.connectionWindow.durationMs) ||
    (raw.connectionWindow.durationMs as number) <= 0 ||
    raw.connectionWindow.basis !== "provider-issued" ||
    raw.activeStream !== "may-outlive-connection-window" ||
    raw.disconnect !== "no-revocation-guarantee"
  )
    return invalid();
  let url: URL;
  try {
    url = new URL(raw.url);
  } catch {
    return invalid();
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password
  )
    return invalid();
  return {
    kind: "desktop",
    url: raw.url,
    connectionWindow: {
      durationMs: raw.connectionWindow.durationMs as number,
      basis: "provider-issued",
    },
    activeStream: "may-outlive-connection-window",
    disconnect: "no-revocation-guarantee",
  };
}
