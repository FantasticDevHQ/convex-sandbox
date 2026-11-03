import type {
  CommandHandle,
  CommandInput,
  ExecutionStore,
  PrepareExecution,
  ExecutionRecord,
  ExecutionResult,
} from "../execution.js";
import { validateCommand } from "./executionProtocol.js";
import { boundedSDK } from "./executionProvider.js";
import { normalizeProviderError } from "./errors.js";

const terminal = (record: ExecutionRecord) =>
  ["completed", "failed", "cancelled"].includes(record.state);
function snapshotHandle({
  sandbox,
  operationId,
}: CommandHandle): CommandHandle {
  return Object.freeze({
    sandbox: Object.freeze({ scope: sandbox.scope, key: sandbox.key }),
    operationId,
  });
}
const key = (record: ExecutionRecord, kind = "execute") =>
  JSON.stringify([
    "convex-sandbox",
    record.scope,
    record.key,
    record.reference.provider,
    record.generation,
    kind,
    record.operationId,
  ]);
export class SandboxExecution {
  readonly #prepare: PrepareExecution;
  constructor(
    readonly store: ExecutionStore,
    prepare: PrepareExecution,
  ) {
    this.#prepare = prepare;
  }

  async get(input: CommandHandle) {
    const handle = snapshotHandle(input);
    const record = await this.store.get(handle);
    if (record)
      await this.#prepare({
        sandbox: handle.sandbox,
        reference: record.reference,
        operation: "executionGet",
      });
    return record;
  }

  async start(
    input: CommandHandle & { input: CommandInput },
  ): Promise<ExecutionRecord> {
    const handle = snapshotHandle(input),
      command = validateCommand(input.input);
    const machine = await this.store.getSandbox(handle.sandbox);
    if (!machine) throw new Error("Sandbox missing");
    const provider = await this.#prepare({
      sandbox: handle.sandbox,
      reference: machine.reference,
      operation: "execute",
    });
    const record = await this.store.reserve({
      ...handle,
      expectedVersion: machine.version,
      idempotency: provider.idempotency,
    });
    const lease = await this.store.claim({ ...handle, mode: "start" });
    if (!lease) return (await this.store.get(handle)) ?? record;
    let result: ExecutionResult;
    try {
      result = {
        snapshot: await boundedSDK((signal) =>
          provider.start(command, {
            signal,
            idempotencyKey: key(lease.record),
          }),
        ),
      };
    } catch (error) {
      const data = normalizeProviderError(error).data;
      result = {
        errorCode: data.code,
        notStarted: data.outcome === "not_started",
      };
    }
    await this.store.publish({ ...handle, token: lease.token, result });
    return (await this.store.get(handle)) ?? record;
  }

  async status(input: CommandHandle, callTimeoutMs = 5000) {
    if (
      !Number.isSafeInteger(callTimeoutMs) ||
      callTimeoutMs < 1 ||
      callTimeoutMs > 10000
    )
      throw new Error("Invalid status deadline");
    const handle = snapshotHandle(input),
      record = await this.store.get(handle);
    if (!record) return null;
    const provider = await this.#prepare({
      sandbox: handle.sandbox,
      reference: record.reference,
      operation: "executionStatus",
    });
    if (terminal(record)) return record;
    const lease = await this.store.claim({ ...handle, mode: "status" });
    if (!lease) return this.store.get(handle);
    let result: ExecutionResult;
    try {
      const snapshot = await boundedSDK(
        (signal) =>
          provider.status(lease.record.executionId, {
            signal,
            idempotencyKey: key(lease.record),
          }),
        callTimeoutMs,
      );
      result = snapshot
        ? { snapshot }
        : { errorCode: "unknown_outcome", notStarted: false };
    } catch (error) {
      result = {
        errorCode: normalizeProviderError(error).data.code,
        notStarted: false,
      };
    }
    await this.store.publish({ ...handle, token: lease.token, result });
    return this.store.get(handle);
  }

  async wait(
    input: CommandHandle & {
      maxWaitMs?: number;
      maxPolls?: number;
      wait?: (ms: number) => Promise<void>;
    },
  ) {
    const handle = snapshotHandle(input);
    const maxWaitMs = input.maxWaitMs ?? 1000,
      maxPolls = input.maxPolls ?? 5;
    validateWait(maxWaitMs, maxPolls);
    const wait =
      input.wait ??
      ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const started = Date.now();
    let record = await this.get(handle);
    for (
      let index = 0;
      record && !terminal(record) && index < maxPolls;
      index++
    ) {
      const remaining = maxWaitMs - (Date.now() - started);
      if (remaining <= 0) break;
      record = await this.status(handle, Math.min(remaining, 5000));
      if (
        !record ||
        terminal(record) ||
        index === maxPolls - 1 ||
        Date.now() - started + 100 >= maxWaitMs
      )
        break;
      await wait(100);
    }
    return record;
  }

  async run(
    input: CommandHandle & { input: CommandInput; maxWaitMs?: number },
  ) {
    const handle = snapshotHandle(input),
      maxWaitMs = input.maxWaitMs ?? 1000;
    validateWait(maxWaitMs, 5);
    const record = await this.start({ ...handle, input: input.input });
    return terminal(record) ? record : this.wait({ ...handle, maxWaitMs });
  }

  async cancel(input: CommandHandle) {
    const handle = snapshotHandle(input),
      record = await this.store.get(handle);
    if (!record) return null;
    const provider = await this.#prepare({
      sandbox: handle.sandbox,
      reference: record.reference,
      operation: "cancelExecution",
    });
    const lease = await this.store.requestCancel(handle);
    if (!lease?.record.executionId) return this.store.get(handle);
    let acknowledgement: "accepted" | "rejected" | "unknown" = "unknown";
    try {
      const result = await boundedSDK((signal) =>
        provider.cancel(lease.record.executionId ?? "", {
          signal,
          idempotencyKey: key(lease.record, "cancelExecution"),
        }),
      );
      acknowledgement = result.acknowledged ? "accepted" : "rejected";
    } catch {
      /* Cancellation uncertainty is distinct from process state. */
    }
    await this.store.acknowledgeCancel({
      ...handle,
      token: lease.token,
      acknowledgement,
    });
    return this.store.get(handle);
  }

  async syncLogs(input: CommandHandle) {
    const handle = snapshotHandle(input),
      record = await this.store.get(handle);
    if (!record) return null;
    const provider = await this.#prepare({
      sandbox: handle.sandbox,
      reference: record.reference,
      operation: "executionLogs",
      sdkLogs: true,
    });
    const lease = await this.store.claimLogs(handle);
    if (!lease?.record.executionId) return this.store.get(handle);
    try {
      const page = await boundedSDK((signal) =>
        provider.logs(lease.record.executionId ?? "", lease.cursor, {
          signal,
          idempotencyKey: key(lease.record, "executionLogs"),
        }),
      );
      await this.store.appendLogs({ ...handle, token: lease.token, page });
    } catch (error) {
      await this.store.appendLogs({
        ...handle,
        token: lease.token,
        errorCode: normalizeProviderError(error).data.code,
      });
    }
    return this.store.get(handle);
  }

  async logs(input: CommandHandle & { cursor: number | null; limit?: number }) {
    const handle = snapshotHandle(input),
      cursor = input.cursor,
      limit = input.limit ?? 16;
    const record = await this.store.get(handle);
    if (record)
      await this.#prepare({
        sandbox: handle.sandbox,
        reference: record.reference,
        operation: "executionLogs",
      });
    return this.store.logs({ ...handle, cursor, limit });
  }
}

function validateWait(maxWaitMs: number, maxPolls: number) {
  if (
    !Number.isSafeInteger(maxWaitMs) ||
    maxWaitMs < 1 ||
    maxWaitMs > 5000 ||
    !Number.isSafeInteger(maxPolls) ||
    maxPolls < 1 ||
    maxPolls > 10
  )
    throw new Error("Invalid short wait budget");
}
