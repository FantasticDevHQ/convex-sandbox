import { v, type Infer } from "convex/values";
import {
  providerReferenceValidator,
  type operationHandleValidator,
  type SandboxKey,
} from "./contracts.js";
import { providerErrorCodeValidator } from "./capabilities.js";
import type { OperationRecord, RegistryRecord } from "./state.js";
import type { ProviderCallContext } from "./lifecycle.js";

export const imageReferenceValidator = v.object({
  provider: v.string(),
  id: v.string(),
  kind: v.union(v.literal("template"), v.literal("disk-snapshot")),
});
export type ImageReference = Infer<typeof imageReferenceValidator>;
export const imageKindValidator = v.union(
  v.literal("snapshotDisk"),
  v.literal("createTemplate"),
  v.literal("fork"),
  v.literal("restore"),
);
export type ImageOperationKind = Infer<typeof imageKindValidator>;
export const imageOutputValidator = v.union(
  v.object({ image: imageReferenceValidator }),
  v.object({ machine: providerReferenceValidator }),
  v.object({ restored: v.literal(true) }),
);
export type ImageOutput = Infer<typeof imageOutputValidator>;
export const imageSnapshotValidator = v.union(
  v.object({ state: v.literal("pending"), operationId: v.string() }),
  v.object({ state: v.literal("ready"), result: imageOutputValidator }),
  v.object({ state: v.literal("failed") }),
);
export type ImageSnapshot = Infer<typeof imageSnapshotValidator>;
export const nativeImageValidator = v.object({
  leaseMode: v.optional(v.union(v.literal("start"), v.literal("status"))),
  source: v.optional(imageReferenceValidator),
  providerOperationId: v.optional(v.string()),
  result: v.optional(imageOutputValidator),
});
export const imageCompletionValidator = v.union(
  imageSnapshotValidator,
  v.object({ errorCode: providerErrorCodeValidator, notStarted: v.boolean() }),
);
export type ImageCompletion = Infer<typeof imageCompletionValidator>;
export interface ImageRequest {
  sandbox: SandboxKey;
  operationId: string;
  kind: ImageOperationKind;
  image?: ImageReference;
}
export const templatePageValidator = v.object({
  items: v.array(
    v.object({
      reference: imageReferenceValidator,
      readiness: v.union(
        v.literal("pending"),
        v.literal("ready"),
        v.literal("failed"),
        v.literal("unknown"),
      ),
    }),
  ),
  nextCursor: v.union(v.string(), v.null()),
  partial: v.boolean(),
});
export type TemplatePage = Infer<typeof templatePageValidator>;
/** Native provider artifacts. No memory preservation or portability is implied. */
export interface ImageAdapter {
  snapshotDisk?(
    providerId: string,
    context: ProviderCallContext,
  ): Promise<ImageSnapshot>;
  createTemplate?(
    providerId: string,
    context: ProviderCallContext,
  ): Promise<ImageSnapshot>;
  fork?(
    providerId: string,
    context: ProviderCallContext,
  ): Promise<ImageSnapshot>;
  restore?(
    providerId: string,
    image: ImageReference,
    context: ProviderCallContext,
  ): Promise<ImageSnapshot>;
  status?(
    providerId: string,
    operationId: string,
    context: ProviderCallContext,
  ): Promise<ImageSnapshot>;
  /** Read-only correlation lookup. Absence never authorizes repeating a mutation. */
  find?(
    providerId: string,
    idempotencyKey: string,
    context: ProviderCallContext,
  ): Promise<ImageSnapshot | null>;
  listTemplates?(
    providerId: string,
    page: { cursor: string | null; limit: number },
    context: ProviderCallContext,
  ): Promise<{
    items: TemplatePage["items"];
    nextCursor: string | null;
    complete: boolean;
  }>;
}
export interface ImageStore {
  getSandbox(sandbox: SandboxKey): Promise<RegistryRecord | null>;
  getOperation(
    handle: Infer<typeof operationHandleValidator>,
  ): Promise<OperationRecord | null>;
  reserve(
    args: ImageRequest & { expectedVersion: number },
  ): Promise<OperationRecord>;
  claim(
    args: Infer<typeof operationHandleValidator> & { mode: "start" | "status" },
  ): Promise<OperationRecord | null>;
  publish(
    args: Infer<typeof operationHandleValidator> & {
      expectedVersion: number;
      result: ImageCompletion;
    },
  ): Promise<boolean>;
}
export const connectionKindValidator = v.union(
  v.literal("preview"),
  v.literal("ssh"),
  v.literal("desktop"),
  v.literal("browser"),
);
export type ConnectionKind = Infer<typeof connectionKindValidator>;
export const connectionHandleValidator = v.object({
  kind: connectionKindValidator,
  url: v.string(),
  expiresAt: v.number(),
  access: v.object({
    kind: v.union(
      v.literal("public"),
      v.literal("token"),
      v.literal("headers"),
      v.literal("ssh-key"),
      v.literal("provider-session"),
    ),
    token: v.optional(v.string()),
    headers: v.optional(v.record(v.string(), v.string())),
  }),
});
export type ConnectionHandle = Infer<typeof connectionHandleValidator>;
export interface ConnectionAdapter {
  kinds: readonly ConnectionKind[];
  get(
    providerId: string,
    request: { kind: ConnectionKind; port?: number; expiresInMs: number },
    context: ProviderCallContext,
  ): Promise<ConnectionHandle>;
}
