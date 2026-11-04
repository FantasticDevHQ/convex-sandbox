import { type Infer, v } from "convex/values";
import { providerErrorCodeValidator } from "./capabilities.js";
import {
  nativeLifecycleJobValidator,
  type NativeLifecycleJob,
} from "./lifecycleJobs.js";
import {
  machineResourcesValidator,
  sandboxStateValidator,
  type SandboxKey,
  type ProviderReference,
} from "./contracts.js";
import {
  registryRecordValidator,
  type RegistryRecord,
  type OperationRecord,
} from "./state.js";

export const providerObservationValidator = v.object({
  providerId: v.string(),
  state: sandboxStateValidator,
  resources: v.optional(machineResourcesValidator),
  lifecycleJob: v.optional(nativeLifecycleJobValidator),
});
export type ProviderObservation = Infer<typeof providerObservationValidator>;
export const completionValidator = v.union(
  v.object({ description: providerObservationValidator }),
  v.object({ errorCode: providerErrorCodeValidator, notStarted: v.boolean() }),
);
export type LifecycleCompletion = Infer<typeof completionValidator>;
export const provisionFields = {
  scope: v.string(),
  key: v.string(),
  provider: v.string(),
  operationId: v.string(),
  idempotency: v.union(v.literal("native"), v.literal("none")),
  status: v.union(
    v.literal("running"),
    v.literal("unknown"),
    v.literal("succeeded"),
    v.literal("failed"),
  ),
  version: v.number(),
  leaseUntil: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
  reference: v.optional(
    v.object({ provider: v.string(), providerId: v.string() }),
  ),
  errorCode: v.optional(providerErrorCodeValidator),
};
export const provisionRecordValidator = v.object(provisionFields);
export type ProvisionRecord = Infer<typeof provisionRecordValidator>;
export const createAdmissionValidator = v.union(
  v.object({ kind: v.literal("bound"), registry: registryRecordValidator }),
  v.object({
    kind: v.literal("provision"),
    admitted: v.boolean(),
    provision: provisionRecordValidator,
  }),
);
export type CreateAdmission = Infer<typeof createAdmissionValidator>;
export interface CreateOptions {
  resources?: Infer<typeof machineResourcesValidator>;
  templateId?: string;
}
export interface ProviderCallContext {
  idempotencyKey: string;
  signal: AbortSignal;
  /** Only present for read-only reconciliation of an accepted lifecycle job. */
  lifecycleJob?: Readonly<NativeLifecycleJob & { kind: LifecycleAction }>;
}
export type LifecycleAction = "start" | "stop" | "delete" | "resumeMemory";
export interface LifecycleStore {
  get(sandbox: SandboxKey): Promise<RegistryRecord | null>;
  getOperation(
    sandbox: SandboxKey,
    operationId: string,
  ): Promise<OperationRecord | null>;
  begin(args: {
    sandbox: SandboxKey;
    expectedVersion: number;
    operationId: string;
    kind: LifecycleAction;
  }): Promise<OperationRecord>;
  reserveCreate(args: {
    sandbox: SandboxKey;
    provider: string;
    operationId: string;
    idempotency: "native" | "none";
  }): Promise<CreateAdmission>;
  getProvision(sandbox: SandboxKey): Promise<ProvisionRecord | null>;
  claimCreateReconciliation(args: {
    sandbox: SandboxKey;
    operationId: string;
  }): Promise<ProvisionRecord | null>;
  finishCreate(args: {
    sandbox: SandboxKey;
    operationId: string;
    expectedVersion: number;
    result: LifecycleCompletion;
  }): Promise<boolean>;
  claimOperation(args: {
    sandbox: SandboxKey;
    operationId: string;
    expectedVersion: number;
    mode: "execute" | "reconcile";
  }): Promise<OperationRecord | null>;
  finishOperation(args: {
    sandbox: SandboxKey;
    operationId: string;
    expectedVersion: number;
    result: LifecycleCompletion;
  }): Promise<boolean>;
  beginRefresh(
    sandbox: SandboxKey,
  ): Promise<{ generation: number; sequence: number }>;
  finishRefresh(args: {
    sandbox: SandboxKey;
    generation: number;
    sequence: number;
    result:
      | {
          state: ProviderObservation["state"];
          resources?: ProviderObservation["resources"];
        }
      | { errorCode: Infer<typeof providerErrorCodeValidator> };
  }): Promise<boolean>;
}
export interface PreparedLifecycle {
  idempotency: "native" | "none";
  invoke(context: ProviderCallContext): Promise<ProviderObservation>;
  lookup?: (
    context: ProviderCallContext,
  ) => Promise<ProviderObservation | null>;
  validate(raw: unknown): ProviderObservation;
}
export type PrepareLifecycle = (input: {
  sandbox: SandboxKey;
  provider: string;
  reference?: ProviderReference;
  action: "create" | LifecycleAction | "describe" | "get" | "observe";
  options?: CreateOptions;
}) => Promise<PreparedLifecycle>;
export const LIFECYCLE_LEASE_MS = 30000;
