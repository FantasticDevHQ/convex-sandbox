import type { SandboxKey } from "../contracts.js";
import type {
  CreateOptions,
  LifecycleAction,
  LifecycleStore,
  PrepareLifecycle,
  PreparedLifecycle,
  LifecycleCompletion,
  CreateAdmission,
  ProvisionRecord,
  ProviderObservation,
} from "../lifecycle.js";
import { normalizeProviderError, SandboxProviderError } from "./errors.js";

export interface ReconciliationPolicy {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxElapsedMs?: number;
  callTimeoutMs?: number;
}
const terminal = (status: string) =>
  ["succeeded", "failed", "cancelled"].includes(status);
const operationKey = (
  sandbox: SandboxKey,
  operationId: string,
  kind: string,
  provider: string,
) =>
  JSON.stringify([
    "convex-sandbox",
    sandbox.scope,
    sandbox.key,
    provider,
    kind,
    operationId,
  ]);

/** Construct through providers.lifecycle(store) in a trusted host action. */
export class SandboxLifecycle {
  constructor(
    readonly store: LifecycleStore,
    readonly prepare: PrepareLifecycle,
  ) {}

  async get(sandbox: SandboxKey) {
    sandbox = snapshotSandbox(sandbox);
    const row = await this.store.get(sandbox);
    if (row)
      await this.prepare({
        sandbox,
        provider: row.reference.provider,
        reference: row.reference,
        action: "get",
      });
    return row;
  }

  async create({
    sandbox,
    provider,
    operationId,
    options,
  }: {
    sandbox: SandboxKey;
    provider: string;
    operationId: string;
    options?: CreateOptions;
  }): Promise<CreateAdmission> {
    sandbox = snapshotSandbox(sandbox);
    const prepared = await this.prepare({
      sandbox,
      provider,
      action: "create",
      options,
    });
    const admission = await this.store.reserveCreate({
      sandbox,
      provider,
      operationId,
      idempotency: prepared.idempotency,
    });
    if (admission.kind === "bound" || !admission.admitted) return admission;
    const claim = admission.provision;
    const result = await attempt(
      (context) => prepared.invoke(context),
      operationKey(sandbox, operationId, "create", provider),
      5000,
    );
    await this.store.finishCreate({
      sandbox,
      operationId,
      expectedVersion: claim.version,
      result,
    });
    const provision = await this.store.getProvision(sandbox);
    if (!provision) throw new Error("Provision missing");
    return { kind: "provision", admitted: true, provision };
  }

  async reconcileCreate({
    sandbox,
    operationId,
  }: {
    sandbox: SandboxKey;
    operationId: string;
  }): Promise<ProvisionRecord | null> {
    sandbox = snapshotSandbox(sandbox);
    const existing = await this.store.getProvision(sandbox);
    if (!existing || existing.operationId !== operationId) return null;
    const prepared = await this.prepare({
      sandbox,
      provider: existing.provider,
      action: "create",
    });
    if (terminal(existing.status)) return existing;
    const claim = await this.store.claimCreateReconciliation({
      sandbox,
      operationId,
    });
    if (!claim) return this.store.getProvision(sandbox);
    const result = prepared.lookup
      ? await attempt(
          async (context) => {
            const found = await prepared.lookup?.(context);
            if (!found)
              throw new SandboxProviderError({
                code: "unknown_outcome",
                outcome: "unknown",
                retryable: false,
              });
            return found;
          },
          operationKey(sandbox, operationId, "create", existing.provider),
          5000,
        )
      : { errorCode: "unknown_outcome" as const, notStarted: false };
    // Lookup absence never proves an interrupted create had no side effects.
    await this.store.finishCreate({
      sandbox,
      operationId,
      expectedVersion: claim.version,
      result:
        "description" in result ? result : { ...result, notStarted: false },
    });
    return this.store.getProvision(sandbox);
  }

  async run({
    sandbox,
    operationId,
    action,
  }: {
    sandbox: SandboxKey;
    operationId: string;
    action: "start" | "stop" | "delete";
  }) {
    sandbox = snapshotSandbox(sandbox);
    const row = await this.store.get(sandbox);
    if (!row) throw new Error("Sandbox missing");
    const kind: LifecycleAction =
      action === "start" && row.observedState === "paused"
        ? "resumeMemory"
        : action;
    const prepared = await this.prepare({
      sandbox,
      provider: row.reference.provider,
      reference: row.reference,
      action: kind,
    });
    const operation = await this.store.begin({
      sandbox,
      expectedVersion: row.version,
      operationId,
      kind,
    });
    if (operation.status !== "pending") return operation;
    const claim = await this.store.claimOperation({
      sandbox,
      operationId,
      expectedVersion: operation.version,
      mode: "execute",
    });
    if (!claim) return this.store.getOperation(sandbox, operationId);
    const result = await attempt(
      (context) => prepared.invoke(context),
      operationKey(sandbox, operationId, kind, row.reference.provider),
      5000,
    );
    await this.store.finishOperation({
      sandbox,
      operationId,
      expectedVersion: claim.version,
      result,
    });
    return this.store.getOperation(sandbox, operationId);
  }

  async refresh(sandbox: SandboxKey) {
    sandbox = snapshotSandbox(sandbox);
    const row = await this.get(sandbox);
    if (!row || row.tombstone) return row;
    const prepared = await this.prepare({
      sandbox,
      provider: row.reference.provider,
      reference: row.reference,
      action: "describe",
    });
    const ticket = await this.store.beginRefresh(sandbox);
    const result = await attempt(
      (context) => prepared.invoke(context),
      operationKey(
        sandbox,
        `refresh-${ticket.generation}-${ticket.sequence}`,
        "describe",
        row.reference.provider,
      ),
      5000,
    );
    await this.store.finishRefresh({
      sandbox,
      ...ticket,
      result:
        "description" in result
          ? {
              state: result.description.state,
              ...(result.description.resources
                ? { resources: result.description.resources }
                : {}),
            }
          : { errorCode: result.errorCode },
    });
    return this.store.get(sandbox);
  }

  async observe({
    sandbox,
    ticket,
    description,
  }: {
    sandbox: SandboxKey;
    ticket: { generation: number; sequence: number };
    description: unknown;
  }): Promise<boolean> {
    sandbox = snapshotSandbox(sandbox);
    ticket = Object.freeze({ ...ticket });
    const row = await this.store.get(sandbox);
    if (!row) return false;
    const prepared = await this.prepare({
      sandbox,
      provider: row.reference.provider,
      reference: row.reference,
      action: "observe",
    });
    if (row.generation !== ticket.generation) return false;
    let value: ProviderObservation;
    try {
      value = prepared.validate(description);
    } catch (error) {
      throw normalizeProviderError(error);
    }
    return this.store.finishRefresh({
      sandbox,
      ...ticket,
      result: {
        state: value.state,
        ...(value.resources ? { resources: value.resources } : {}),
      },
    });
  }

  async reconcile({
    sandbox,
    operationId,
    policy = {},
    wait = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms)),
  }: {
    sandbox: SandboxKey;
    operationId: string;
    policy?: ReconciliationPolicy;
    wait?: (ms: number) => Promise<void>;
  }) {
    sandbox = snapshotSandbox(sandbox);
    const settings = pollingPolicy(policy);
    const started = Date.now();
    for (let index = 0; index < settings.maxAttempts; index++) {
      const operation = await this.store.getOperation(sandbox, operationId);
      const row = await this.store.get(sandbox);
      if (!operation || !row) return null;
      if (!["start", "resumeMemory", "stop", "delete"].includes(operation.kind))
        throw new Error("Invalid lifecycle operation");
      const prepared = await this.prepare({
        sandbox,
        provider: operation.reference.provider,
        reference: operation.reference,
        action: "describe",
      });
      if (terminal(operation.status)) return operation;
      const remaining = settings.maxElapsedMs - (Date.now() - started);
      if (remaining <= 0) return operation;
      const claim = await this.store.claimOperation({
        sandbox,
        operationId,
        expectedVersion: operation.version,
        mode: "reconcile",
      });
      if (!claim) return this.store.getOperation(sandbox, operationId);
      const result =
        row.tombstone && !claim.nativeLifecycle
          ? {
              description: {
                providerId: row.reference.providerId,
                state: "deleted" as const,
              },
            }
          : await attempt(
              (context) =>
                prepared.invoke({
                  ...context,
                  ...(claim.nativeLifecycle
                    ? {
                        lifecycleJob: Object.freeze({
                          id: claim.nativeLifecycle.id,
                          kind: operation.kind as LifecycleAction,
                        }),
                      }
                    : {}),
                }),
              operationKey(
                sandbox,
                operationId,
                operation.kind,
                operation.reference.provider,
              ),
              Math.min(settings.callTimeoutMs, remaining),
            );
      // Read failures do not establish the outcome of the original mutation.
      await this.store.finishOperation({
        sandbox,
        operationId,
        expectedVersion: claim.version,
        result:
          "description" in result ? result : { ...result, notStarted: false },
      });
      const updated = await this.store.getOperation(sandbox, operationId);
      if (
        !updated ||
        terminal(updated.status) ||
        index === settings.maxAttempts - 1
      )
        return updated;
      const delay = Math.min(
        settings.baseDelayMs * 2 ** index,
        settings.maxDelayMs,
      );
      if (Date.now() - started + delay >= settings.maxElapsedMs) return updated;
      await wait(delay);
    }
    return this.store.getOperation(sandbox, operationId);
  }
}

async function attempt(
  invoke: PreparedLifecycle["invoke"],
  idempotencyKey: string,
  timeoutMs: number,
): Promise<LifecycleCompletion> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const description = await Promise.race([
      invoke({ idempotencyKey, signal: controller.signal }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(
            new SandboxProviderError({
              code: "timeout",
              outcome: "unknown",
              retryable: false,
            }),
          );
        }, timeoutMs);
      }),
    ]);
    return { description };
  } catch (error) {
    const data = normalizeProviderError(error).data;
    return { errorCode: data.code, notStarted: data.outcome === "not_started" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
function pollingPolicy(policy: ReconciliationPolicy) {
  const settings = {
    maxAttempts: 3,
    baseDelayMs: 250,
    maxDelayMs: 2000,
    maxElapsedMs: 10000,
    callTimeoutMs: 5000,
    ...policy,
  };
  for (const [key, value] of Object.entries(settings))
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error(`Invalid polling policy: ${key}`);
  if (
    settings.maxAttempts > 10 ||
    settings.maxDelayMs > 30000 ||
    settings.baseDelayMs > settings.maxDelayMs ||
    settings.maxElapsedMs > 120000 ||
    settings.callTimeoutMs > 10000
  )
    throw new Error("Polling policy exceeds bounds");
  return settings;
}

function snapshotSandbox(sandbox: SandboxKey): SandboxKey {
  return Object.freeze({ scope: sandbox.scope, key: sandbox.key });
}
