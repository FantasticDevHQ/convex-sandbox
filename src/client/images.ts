import type { SandboxKey } from "../contracts.js";
import type { OperationRecord, RegistryRecord } from "../state.js";
import type { Capabilities } from "../capabilities.js";
import {
  connectionKindValidator,
  imageKindValidator,
  type ImageStore,
  type ImageRequest,
  type ImageAdapter,
  type ImageCompletion,
  type TemplatePage,
  type ConnectionKind,
} from "../images.js";
import { normalizeImage, normalizeImageSnapshot } from "../imageProtocol.js";
import {
  requireCapability,
  normalizeProviderError,
  SandboxProviderError,
} from "./errors.js";
import type { SandboxAdapter, AuthorizeSandbox } from "./providers.js";
import { boundedSDK } from "./executionProvider.js";
import { fileCursor, integer, hasControls } from "./fileProtocol.js";
import { normalizeConnection } from "./connectionProtocol.js";

const operationIdentity = (value: string) => {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 256 ||
    hasControls(value)
  )
    throw new Error("Invalid image operation identity");
  return value;
};
const terminal = (op: OperationRecord) =>
  ["succeeded", "failed", "cancelled"].includes(op.status);
type Handle = { sandbox: SandboxKey; operationId: string };

/** SDK dispatch in trusted host actions, durable image jobs in shared operation state. */
export class SandboxImages {
  constructor(
    private readonly store: ImageStore,
    private readonly provider: (name: string) => {
      adapter: SandboxAdapter;
      capabilities: Capabilities;
    },
    private readonly authorize: AuthorizeSandbox,
  ) {}

  private async binding(
    input: SandboxKey,
    operation: Parameters<AuthorizeSandbox>[0]["operation"],
  ) {
    const identity = (value: string) => {
      if (typeof value !== "string" || !value || value.length > 1024)
        throw new Error("Invalid sandbox identity");
      return value;
    };
    const sandbox = Object.freeze({
      scope: identity(input.scope),
      key: identity(input.key),
    });
    const found = await this.store.getSandbox(sandbox);
    if (
      !found ||
      found.tombstone ||
      found.scope !== sandbox.scope ||
      found.key !== sandbox.key
    )
      return this.stale();
    const row = { ...found, reference: Object.freeze({ ...found.reference }) };
    await this.authorize(
      Object.freeze({ sandbox, reference: row.reference, operation }),
    );
    await this.current(sandbox, row);
    return { sandbox, row };
  }
  private stale(): never {
    throw new SandboxProviderError({
      code: "stale_resource",
      outcome: "not_started",
      retryable: false,
    });
  }
  private async current(sandbox: SandboxKey, row: RegistryRecord) {
    const current = await this.store.getSandbox(sandbox);
    if (
      !current ||
      current.scope !== sandbox.scope ||
      current.key !== sandbox.key ||
      current.tombstone ||
      current.generation !== row.generation ||
      current.reference.provider !== row.reference.provider ||
      current.reference.providerId !== row.reference.providerId
    )
      this.stale();
  }
  private unsupported(): never {
    throw new SandboxProviderError({
      code: "unsupported",
      outcome: "not_started",
      retryable: false,
    });
  }
  private key(op: OperationRecord) {
    return JSON.stringify([
      "images",
      op.scope,
      op.key,
      op.generation,
      op.reference.provider,
      op.reference.providerId,
      op.kind,
      op.operationId,
    ]);
  }

  async run(input: ImageRequest): Promise<OperationRecord> {
    const kind = input.kind,
      operationId = operationIdentity(input.operationId);
    if (
      operationId.length > 256 ||
      !imageKindValidator.members.some((member) => member.value === kind)
    )
      throw new Error("Invalid image operation");
    const source = input.image
      ? normalizeImage(input.image, input.image.provider)
      : undefined;
    const { sandbox, row } = await this.binding(input.sandbox, kind);
    if (source && source.provider !== row.reference.provider)
      throw new Error("Image provider conflict");
    if ((kind === "restore") !== (source !== undefined))
      throw new Error(
        "Restore requires an image; other operations do not accept one",
      );
    const provider = this.provider(row.reference.provider);
    requireCapability(provider.capabilities, kind);
    const sdk = provider.adapter.images;
    if (!sdk || typeof sdk[kind] !== "function") return this.unsupported();
    await this.store.reserve({
      sandbox,
      operationId,
      kind,
      ...(source ? { image: source } : {}),
      expectedVersion: row.version,
    });
    const claim = await this.store.claim({
      sandbox,
      operationId,
      mode: "start",
    });
    if (claim) await this.perform(sandbox, claim, sdk, "start");
    const record = await this.store.getOperation({ sandbox, operationId });
    if (!record) throw new Error("Image operation missing");
    return record;
  }
  async get(input: Handle): Promise<OperationRecord | null> {
    const operationId = operationIdentity(input.operationId);
    const { sandbox } = await this.binding(input.sandbox, "imageGet");
    const op = await this.store.getOperation({ sandbox, operationId });
    return op?.nativeImage ? op : null;
  }
  async status(input: Handle): Promise<OperationRecord | null> {
    const operationId = operationIdentity(input.operationId);
    const { sandbox, row } = await this.binding(input.sandbox, "imageStatus");
    const existing = await this.store.getOperation({ sandbox, operationId });
    if (!existing?.nativeImage || terminal(existing))
      return existing?.nativeImage ? existing : null;
    if (
      existing.generation !== row.generation ||
      existing.reference.provider !== row.reference.provider ||
      existing.reference.providerId !== row.reference.providerId
    )
      return this.stale();
    const provider = this.provider(row.reference.provider);
    requireCapability(provider.capabilities, existing.kind);
    const sdk = provider.adapter.images;
    if (
      !sdk ||
      (existing.nativeImage.providerOperationId ? !sdk.status : !sdk.find)
    ) {
      if (!existing.nativeImage.providerOperationId) {
        const claim = await this.store.claim({
          sandbox,
          operationId,
          mode: "status",
        });
        if (claim)
          await this.store.publish({
            sandbox,
            operationId,
            expectedVersion: claim.version,
            result: { errorCode: "unknown_outcome", notStarted: false },
          });
        return this.store.getOperation({ sandbox, operationId });
      }
      return this.unsupported();
    }
    const claim = await this.store.claim({
      sandbox,
      operationId,
      mode: "status",
    });
    if (claim) await this.perform(sandbox, claim, sdk, "status");
    return this.store.getOperation({ sandbox, operationId });
  }
  private async perform(
    sandbox: SandboxKey,
    claim: OperationRecord,
    sdk: ImageAdapter,
    mode: "start" | "status",
  ) {
    const kind = claim.kind;
    if (
      !imageKindValidator.members.some((member) => member.value === kind) ||
      !claim.nativeImage
    )
      throw new Error("Invalid image operation");
    const imageKind = kind as ImageRequest["kind"],
      id = claim.reference.providerId;
    let result: ImageCompletion;
    try {
      const raw = await boundedSDK(async (signal) => {
        const key = this.key(claim),
          nativeJob = claim.nativeImage?.providerOperationId;
        const context = {
          idempotencyKey:
            mode === "status" && nativeJob ? `${key}:status:${nativeJob}` : key,
          signal,
        };
        if (mode === "status")
          return nativeJob
            ? sdk.status
              ? sdk.status(id, nativeJob, context)
              : this.unsupported()
            : sdk.find
              ? sdk.find(id, key, context)
              : null;
        if (imageKind === "restore")
          return sdk.restore && claim.nativeImage?.source
            ? sdk.restore(id, claim.nativeImage.source, context)
            : this.unsupported();
        const method = sdk[imageKind];
        if (!method) return this.unsupported();
        return method.call(sdk, id, context);
      });
      if (raw === null)
        result = { errorCode: "unknown_outcome", notStarted: false };
      else {
        try {
          result = normalizeImageSnapshot(
            raw,
            imageKind,
            claim.reference.provider,
            claim.nativeImage.providerOperationId,
          );
        } catch {
          throw new SandboxProviderError({
            code: "validation",
            outcome: "unknown",
            retryable: false,
          });
        }
      }
    } catch (error) {
      const safe = normalizeProviderError(error);
      result = {
        errorCode: safe.data.code,
        notStarted: mode === "start" && safe.data.outcome === "not_started",
      };
    }
    await this.store.publish({
      sandbox,
      operationId: claim.operationId,
      expectedVersion: claim.version,
      result,
    });
  }
  async listTemplates(input: {
    sandbox: SandboxKey;
    cursor?: string | null;
    limit?: number;
  }): Promise<TemplatePage> {
    const cursor = fileCursor(input.cursor ?? null),
      limit = integer(input.limit ?? 50, 1, 100);
    const { sandbox, row } = await this.binding(input.sandbox, "listTemplates");
    const provider = this.provider(row.reference.provider);
    requireCapability(provider.capabilities, "listTemplates");
    const sdk = provider.adapter.images;
    if (!sdk?.listTemplates) return this.unsupported();
    const raw = await boundedSDK((signal) =>
      sdk.listTemplates
        ? sdk.listTemplates(
            row.reference.providerId,
            { cursor, limit },
            {
              signal,
              idempotencyKey: JSON.stringify([
                "templates",
                sandbox,
                cursor,
                limit,
              ]),
            },
          )
        : this.unsupported(),
    );
    if (!raw || !Array.isArray(raw.items) || typeof raw.complete !== "boolean")
      throw new Error("Invalid template page");
    const nextCursor = fileCursor(raw.nextCursor);
    if (raw.complete && nextCursor !== null)
      throw new Error("Invalid template page");
    const items = raw.items.slice(0, limit).map((item) => {
      if (
        !item ||
        !["pending", "ready", "failed", "unknown"].includes(item.readiness)
      )
        throw new Error("Invalid template readiness");
      return {
        reference: normalizeImage(item.reference, row.reference.provider),
        readiness: item.readiness,
      };
    });
    await this.current(sandbox, row);
    return {
      items,
      nextCursor,
      partial: !raw.complete || raw.items.length > limit,
    };
  }
  async connection(input: {
    sandbox: SandboxKey;
    kind: ConnectionKind;
    port?: number;
    expiresInMs?: number;
  }) {
    const kind = input.kind,
      port =
        input.port === undefined ? undefined : integer(input.port, 1, 65535);
    if (
      !connectionKindValidator.members.some((member) => member.value === kind)
    )
      throw new Error("Invalid connection kind");
    const expiresInMs = integer(input.expiresInMs ?? 60000, 1, 300000);
    const { sandbox, row } = await this.binding(input.sandbox, "getConnection");
    const provider = this.provider(row.reference.provider);
    requireCapability(provider.capabilities, "getConnection");
    const sdk = provider.adapter.connections;
    if (
      !sdk ||
      !Array.isArray(sdk.kinds) ||
      !sdk.kinds.includes(kind) ||
      typeof sdk.get !== "function"
    )
      return this.unsupported();
    const deadline = Date.now() + expiresInMs;
    const raw = await boundedSDK((signal) =>
      sdk.get(
        row.reference.providerId,
        { kind, expiresInMs, ...(port === undefined ? {} : { port }) },
        {
          signal,
          idempotencyKey: JSON.stringify(["connection", sandbox, kind, port]),
        },
      ),
    );
    await this.current(sandbox, row);
    return normalizeConnection(raw, kind, deadline);
  }
}
