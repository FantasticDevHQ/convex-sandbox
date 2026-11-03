import type {
  ExecutionStore,
  ExecutionSnapshot,
  ProviderLogPage,
} from "../execution.js";
import type { ConnectionHandle } from "../images.js";
import type { FileTransfer } from "../files.js";
import { truncateUtf8 } from "../output.js";
import { hostError } from "./errors.js";

function secretList(input: readonly string[]): readonly string[] {
  if (
    !Array.isArray(input) ||
    input.length > 64 ||
    input.reduce(
      (size, value) =>
        size + (typeof value === "string" ? value.length : 65537),
      0,
    ) > 65536 ||
    input.some(
      (value) => typeof value !== "string" || !value || value.length > 4096,
    )
  )
    return hostError("validation");
  return Object.freeze([...new Set(input)]);
}
/** Conservative text utility, not a detector for arbitrary or fragmented secrets. */
export function redactSandboxText(
  text: string,
  secrets: readonly string[] = [],
): string {
  if (typeof text !== "string") return hostError("validation");
  let result = text.slice(0, 65536);
  const values = secretList(secrets);
  if (values.length) {
    const pattern = [...values]
      .sort((a, b) => b.length - a.length)
      .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");
    result = result.replace(new RegExp(pattern, "g"), "[redacted]");
  }
  return result
    .replace(/\b(?:https?|wss?|ssh):\/\/[^\s<>"']+/gi, "[redacted-url]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]");
}
export function protectSecretHandle<T extends ConnectionHandle | FileTransfer>(
  handle: T,
  secrets: readonly string[],
): T {
  const snapshot = structuredClone(handle);
  const encoded = JSON.stringify(snapshot);
  for (const value of secretList(secrets)) {
    if (
      [
        value,
        encodeURIComponent(value),
        JSON.stringify(value).slice(1, -1),
      ].some((variant) => encoded.includes(variant))
    )
      return hostError("validation");
  }
  return snapshot;
}
export type OutputPolicy =
  | { retention?: "none"; secrets?: readonly string[] }
  | {
      retention: "redacted";
      secrets?: readonly string[];
      redact(text: string): string;
    };

/** Default: no text retention. Opt-in redactors must approve safe content themselves. */
export function protectExecutionStore(
  store: ExecutionStore,
  policy: OutputPolicy = {},
): ExecutionStore {
  const retention = policy.retention ?? "none",
    secrets = secretList(policy.secrets ?? []);
  const redact = "redact" in policy ? policy.redact : undefined;
  if (
    !["none", "redacted"].includes(retention) ||
    (retention === "redacted" && typeof redact !== "function")
  )
    return hostError("validation");
  function output(text: string) {
    if (retention === "none") return { text: "", changed: text.length > 0 };
    let approved: string;
    try {
      approved = redact ? redact(redactSandboxText(text, secrets)) : "";
    } catch {
      approved = "[redacted]";
    }
    if (typeof approved !== "string") approved = "[redacted]";
    const bounded = truncateUtf8(redactSandboxText(approved, secrets), 4096);
    return {
      text: bounded.text,
      changed: bounded.text !== text || bounded.truncated,
    };
  }
  function snapshot(raw: ExecutionSnapshot): ExecutionSnapshot {
    if (!raw.output) return raw;
    const stdout = output(raw.output.stdout),
      stderr = output(raw.output.stderr);
    return {
      ...raw,
      output: {
        stdout: stdout.text,
        stderr: stderr.text,
        truncated: raw.output.truncated || stdout.changed || stderr.changed,
      },
    };
  }
  function page(raw: ProviderLogPage): ProviderLogPage {
    if (
      raw.nextCursor !== null &&
      redactSandboxText(raw.nextCursor, secrets) !== raw.nextCursor
    )
      return hostError("validation");
    let changed = false;
    const entries = raw.entries.flatMap((entry) => {
      const safe = output(entry.text);
      changed ||= safe.changed;
      return safe.text ? [{ stream: entry.stream, text: safe.text }] : [];
    });
    return {
      entries,
      nextCursor: raw.nextCursor,
      complete: raw.complete,
      truncated: raw.truncated === true || changed,
    };
  }
  return {
    getSandbox: (args) => store.getSandbox(args),
    get: (args) => store.get(args),
    reserve: (args) => store.reserve(args),
    claim: (args) => store.claim(args),
    publish: async (args) =>
      store.publish({
        ...args,
        result:
          "snapshot" in args.result
            ? { snapshot: snapshot(args.result.snapshot) }
            : args.result,
      }),
    requestCancel: (args) => store.requestCancel(args),
    acknowledgeCancel: (args) => store.acknowledgeCancel(args),
    claimLogs: (args) => store.claimLogs(args),
    appendLogs: async (args) =>
      store.appendLogs({
        ...args,
        ...(args.page ? { page: page(args.page) } : {}),
      }),
    logs: async (args) => {
      const raw = await store.logs(args);
      let changed = false;
      const entries = raw.entries.flatMap((entry) => {
        const safe = output(entry.text);
        changed ||= safe.changed;
        return safe.text
          ? [
              {
                sequence: entry.sequence,
                stream: entry.stream,
                text: safe.text,
              },
            ]
          : [];
      });
      return {
        entries,
        nextCursor: raw.nextCursor,
        isDone: raw.isDone,
        truncated: raw.truncated || changed,
      };
    },
  };
}
