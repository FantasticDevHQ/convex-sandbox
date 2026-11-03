import { type Infer, v } from "convex/values";
import { providerReferenceValidator, type SandboxKey } from "./contracts.js";
import { providerErrorCodeValidator } from "./capabilities.js";
import type { RegistryRecord } from "./state.js";
import type { ProviderCallContext } from "./lifecycle.js";

export const commandInputValidator = v.union(
  v.object({
    kind: v.literal("shell"),
    command: v.string(),
    cwd: v.optional(v.string()),
    timeoutMs: v.optional(v.number()),
    env: v.optional(v.record(v.string(), v.string())),
  }),
  v.object({
    kind: v.literal("argv"),
    executable: v.string(),
    args: v.array(v.string()),
    cwd: v.optional(v.string()),
    timeoutMs: v.optional(v.number()),
    env: v.optional(v.record(v.string(), v.string())),
  }),
);
export type CommandInput = Infer<typeof commandInputValidator>;
export const commandHandleValidator = v.object({
  sandbox: v.object({ scope: v.string(), key: v.string() }),
  operationId: v.string(),
});
export type CommandHandle = Infer<typeof commandHandleValidator>;
export const executionStateValidator = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
  v.literal("unknown"),
);
export const cancellationValidator = v.object({
  requested: v.boolean(),
  acknowledgement: v.union(
    v.literal("none"),
    v.literal("pending"),
    v.literal("accepted"),
    v.literal("rejected"),
    v.literal("unknown"),
  ),
});
export const executionFields = {
  scope: v.string(),
  key: v.string(),
  operationId: v.string(),
  reference: providerReferenceValidator,
  generation: v.number(),
  version: v.number(),
  executionId: v.optional(v.string()),
  state: executionStateValidator,
  exitCode: v.optional(v.number()),
  errorCode: v.optional(providerErrorCodeValidator),
  idempotency: v.union(v.literal("native"), v.literal("none")),
  cancellation: cancellationValidator,
  outputBytes: v.number(),
  outputTruncated: v.boolean(),
  logErrorCode: v.optional(providerErrorCodeValidator),
  createdAt: v.number(),
  updatedAt: v.number(),
};
export const executionRecordValidator = v.object(executionFields);
export type ExecutionRecord = Infer<typeof executionRecordValidator>;
export const snapshotValidator = v.object({
  executionId: v.string(),
  state: executionStateValidator,
  exitCode: v.optional(v.number()),
  output: v.optional(
    v.object({
      stdout: v.string(),
      stderr: v.string(),
      truncated: v.boolean(),
    }),
  ),
});
export type ExecutionSnapshot = Infer<typeof snapshotValidator>;
export const executionResultValidator = v.union(
  v.object({ snapshot: snapshotValidator }),
  v.object({ errorCode: providerErrorCodeValidator, notStarted: v.boolean() }),
);
export type ExecutionResult = Infer<typeof executionResultValidator>;
export const logEntryValidator = v.object({
  stream: v.union(v.literal("stdout"), v.literal("stderr")),
  text: v.string(),
});
export const providerLogPageValidator = v.object({
  entries: v.array(logEntryValidator),
  nextCursor: v.union(v.string(), v.null()),
  complete: v.boolean(),
  truncated: v.optional(v.boolean()),
});
export type ProviderLogPage = Infer<typeof providerLogPageValidator>;
export const cachedLogValidator = v.object({
  sequence: v.number(),
  stream: v.union(v.literal("stdout"), v.literal("stderr")),
  text: v.string(),
});
export const cachedLogPageValidator = v.object({
  entries: v.array(cachedLogValidator),
  nextCursor: v.union(v.number(), v.null()),
  isDone: v.boolean(),
  truncated: v.boolean(),
});
export type CachedLogPage = Infer<typeof cachedLogPageValidator>;
export const executionLeaseValidator = v.object({
  record: executionRecordValidator,
  token: v.number(),
});
export type ExecutionLease = Infer<typeof executionLeaseValidator>;
export const logLeaseValidator = v.object({
  record: executionRecordValidator,
  token: v.number(),
  cursor: v.union(v.string(), v.null()),
});
export type LogLease = Infer<typeof logLeaseValidator>;
export const EXECUTION_LOG_BYTES = 65536;
export const EXECUTION_LOG_CHUNKS = 32;
export const LOG_CHUNK_BYTES = 4096;
export const EXECUTION_LEASE_MS = 30000;

export interface ExecutionAdapter {
  idempotency: "native" | "none";
  start(
    providerId: string,
    input: CommandInput,
    context: ProviderCallContext,
  ): Promise<ExecutionSnapshot>;
  status(
    providerId: string,
    executionId: string,
    context: ProviderCallContext,
  ): Promise<ExecutionSnapshot>;
  find?(
    providerId: string,
    idempotencyKey: string,
    context: ProviderCallContext,
  ): Promise<ExecutionSnapshot | null>;
  cancel?(
    providerId: string,
    executionId: string,
    context: ProviderCallContext,
  ): Promise<{ acknowledged: boolean }>;
  logs?(
    providerId: string,
    executionId: string,
    request: { cursor: string | null; maxEntries: number; maxBytes: number },
    context: ProviderCallContext,
  ): Promise<ProviderLogPage>;
}
export interface ExecutionStore {
  getSandbox(sandbox: SandboxKey): Promise<RegistryRecord | null>;
  get(handle: CommandHandle): Promise<ExecutionRecord | null>;
  reserve(
    args: CommandHandle & {
      expectedVersion: number;
      idempotency: "native" | "none";
    },
  ): Promise<ExecutionRecord>;
  claim(
    args: CommandHandle & { mode: "start" | "status" },
  ): Promise<ExecutionLease | null>;
  publish(
    args: CommandHandle & { token: number; result: ExecutionResult },
  ): Promise<boolean>;
  requestCancel(handle: CommandHandle): Promise<ExecutionLease | null>;
  acknowledgeCancel(
    args: CommandHandle & {
      token: number;
      acknowledgement: "accepted" | "rejected" | "unknown";
    },
  ): Promise<boolean>;
  claimLogs(handle: CommandHandle): Promise<LogLease | null>;
  appendLogs(
    args: CommandHandle & {
      token: number;
      page?: ProviderLogPage;
      errorCode?: Infer<typeof providerErrorCodeValidator>;
    },
  ): Promise<boolean>;
  logs(
    args: CommandHandle & { cursor: number | null; limit: number },
  ): Promise<CachedLogPage>;
}
export interface PreparedExecution {
  idempotency: "native" | "none";
  start(
    input: CommandInput,
    context: ProviderCallContext,
  ): Promise<ExecutionSnapshot>;
  status(
    executionId: string | undefined,
    context: ProviderCallContext,
  ): Promise<ExecutionSnapshot | null>;
  cancel(
    executionId: string,
    context: ProviderCallContext,
  ): Promise<{ acknowledged: boolean }>;
  logs(
    executionId: string,
    cursor: string | null,
    context: ProviderCallContext,
  ): Promise<ProviderLogPage>;
}
export type PrepareExecution = (input: {
  sandbox: SandboxKey;
  reference: Infer<typeof providerReferenceValidator>;
  operation:
    | "execute"
    | "executionStatus"
    | "executionGet"
    | "executionLogs"
    | "cancelExecution";
  sdkLogs?: boolean;
}) => Promise<PreparedExecution>;
