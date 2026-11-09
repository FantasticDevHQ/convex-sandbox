import { expect, test, vi } from "vitest";
import {
  defineCapabilities,
  normalizeDesktopSession,
  type DesktopSession,
} from "@fantastic.dev/convex-sandbox";
import { normalizeConnection } from "../../src/client/connectionProtocol.js";

const session = {
  kind: "desktop",
  url: "https://desktop.example/stream.html#token=synthetic-viewer",
  connectionWindow: { durationMs: 600000, basis: "provider-issued" },
  activeStream: "may-outlive-connection-window",
  disconnect: "no-revocation-guarantee",
} as const satisfies DesktopSession;

test("AC-001 lifetime semantics keep connection window separate from stream revocation", () => {
  vi.useFakeTimers();
  try {
    const result = normalizeDesktopSession(session);
    vi.advanceTimersByTime(600001);
    expect(normalizeDesktopSession(result)).toEqual(session);
    expect(result).not.toHaveProperty("expiresAt");
    expect(result).not.toBe(session);
    expect(result.connectionWindow).not.toBe(session.connectionWindow);
    expect(
      defineCapabilities({ version: 1, supported: ["getDesktopSession"] })
        .supported,
    ).toEqual(["getDesktopSession"]);
  } finally {
    vi.useRealTimers();
  }
});

test.each([
  { ...session, expiresAt: Date.now() + 600000 },
  { ...session, activeStream: "revoked-at-window-end" },
  { ...session, disconnect: "revokes-token" },
  { ...session, connectionWindow: { durationMs: 0, basis: "provider-issued" } },
  {
    ...session,
    connectionWindow: { durationMs: Infinity, basis: "provider-issued" },
  },
  {
    ...session,
    connectionWindow: { durationMs: 1.5, basis: "provider-issued" },
  },
  {
    ...session,
    connectionWindow: { durationMs: 600000, basis: "client-received" },
  },
  { ...session, url: "http://desktop.example/view" },
  { ...session, url: "https://api-key@desktop.example/view" },
  { ...session, url: " https://desktop.example/view" },
  { ...session, url: "https://desktop.example/\nview" },
  { ...session, url: `https://desktop.example/${"a".repeat(16384)}` },
  { ...session, apiKey: "synthetic-server-only" },
  { ...session, provisioning: true },
  null,
])("AC-001 rejects invalid or misleading native session metadata %#", (raw) => {
  expect(() => normalizeDesktopSession(raw)).toThrow("Invalid desktop session");
});

test("AC-002 existing expiry regression retains strict getConnection validation", () => {
  const now = Date.now();
  const handle = {
    kind: "desktop" as const,
    url: session.url,
    access: { kind: "provider-session" as const },
    expiresAt: now + 10000,
  };
  expect(normalizeConnection(handle, "desktop", now + 20000)).toEqual(handle);
  for (const expiresAt of [
    undefined,
    now - 1,
    now,
    now + 20001,
    Infinity,
    now + 0.5,
  ]) {
    expect(() =>
      normalizeConnection(
        { ...handle, expiresAt } as typeof handle,
        "desktop",
        now + 20000,
      ),
    ).toThrow("Invalid connection handle");
  }
  expect(() =>
    normalizeConnection(
      session as unknown as typeof handle,
      "desktop",
      now + 600000,
    ),
  ).toThrow("Invalid connection handle");
});
