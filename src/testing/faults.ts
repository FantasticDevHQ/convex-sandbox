import type {
  ProviderRegistration,
  SandboxAdapter,
} from "../client/providers.js";
import { SandboxProviderError } from "../client/errors.js";

export type AdapterMethod =
  | "describe"
  | "create"
  | "findCreate"
  | "start"
  | "stop"
  | "delete"
  | "resumeMemory"
  | `execution.${"start" | "status" | "find" | "cancel" | "logs"}`
  | `files.${"read" | "write" | "list" | "delete" | "transfer"}`
  | `images.${"snapshotDisk" | "createTemplate" | "fork" | "restore" | "status" | "find" | "listTemplates"}`
  | "connections.get";
export interface FaultController {
  failNext(method: AdapterMethod, phase: "before" | "after"): void;
  counts(): Partial<
    Record<AdapterMethod, { attempts: number; dispatched: number }>
  >;
}
/** Generic SDK-boundary injection. After faults conceal an already-applied result. */
export function instrumentAdapter(input: ProviderRegistration): {
  provider: ProviderRegistration;
  faults: FaultController;
} {
  const plans = new Map<string, ("before" | "after")[]>();
  const counters = new Map<string, { attempts: number; dispatched: number }>();
  const methods = new Set<string>();
  function group<T extends object>(
    source: T,
    fields: readonly (keyof T & string)[],
    prefix = "",
  ): T {
    const result = {} as T;
    for (const field of fields) {
      const value = source[field];
      if (value === undefined) continue;
      if (typeof value !== "function") {
        Object.defineProperty(result, field, {
          value: Array.isArray(value) ? [...value] : value,
          enumerable: true,
        });
        continue;
      }
      const method = `${prefix}${field}`;
      methods.add(method);
      Object.defineProperty(result, field, {
        enumerable: true,
        value: async (...args: unknown[]) => {
          const counter = counters.get(method) ?? {
            attempts: 0,
            dispatched: 0,
          };
          counters.set(method, counter);
          counter.attempts++;
          const phase = plans.get(method)?.shift();
          if (phase === "before")
            throw new SandboxProviderError({
              code: "capacity",
              outcome: "not_started",
              retryable: true,
            });
          counter.dispatched++;
          const response: unknown = await Reflect.apply(value, source, args);
          if (phase === "after")
            throw new SandboxProviderError({
              code: "unknown_outcome",
              outcome: "unknown",
              retryable: false,
            });
          return response;
        },
      });
    }
    return result;
  }
  const source = input.adapter;
  const adapter: SandboxAdapter = group(source, [
    "describe",
    "create",
    "findCreate",
    "start",
    "stop",
    "delete",
    "resumeMemory",
  ]);
  if (source.execution)
    adapter.execution = group(
      source.execution,
      ["idempotency", "start", "status", "find", "cancel", "logs"],
      "execution.",
    );
  if (source.files)
    adapter.files = group(
      source.files,
      ["read", "write", "list", "delete", "transfer", "transferDirections"],
      "files.",
    );
  if (source.images)
    adapter.images = group(
      source.images,
      [
        "snapshotDisk",
        "createTemplate",
        "fork",
        "restore",
        "status",
        "find",
        "listTemplates",
      ],
      "images.",
    );
  if (source.connections)
    adapter.connections = group(
      source.connections,
      ["kinds", "get"],
      "connections.",
    );
  return {
    provider: { ...input, adapter },
    faults: {
      failNext(method, phase) {
        if (
          !methods.has(method) ||
          !["before", "after"].includes(phase) ||
          [...plans.values()].reduce((sum, list) => sum + list.length, 0) >= 32
        )
          throw new Error("Invalid or full adapter fault plan");
        const list = plans.get(method) ?? [];
        list.push(phase);
        plans.set(method, list);
      },
      counts: () =>
        Object.fromEntries(
          [...counters].map(([method, count]) => [method, { ...count }]),
        ),
    },
  };
}
