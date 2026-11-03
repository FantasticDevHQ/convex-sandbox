import type { Capabilities } from "../capabilities.js";
import type { SandboxKey } from "../contracts.js";
import type { RegistryRecord } from "../state.js";
import type {
  FileAdapter,
  FileOperation,
  FileStore,
  FileRequest,
  FileReadRequest,
  FileRead,
  FileTextRead,
  FileWriteRequest,
  FileTextWriteRequest,
  FileListRequest,
  FileList,
  FileTransferRequest,
} from "../files.js";
import type { SandboxAdapter, AuthorizeSandbox } from "./providers.js";
import { requireCapability, SandboxProviderError } from "./errors.js";
import { boundedSDK } from "./executionProvider.js";
import {
  INLINE_FILE_LIMIT,
  hasControls,
  binaryCopy,
  fileCursor,
  filePath,
  integer,
  transferHandle,
} from "./fileProtocol.js";

export class SandboxFiles {
  constructor(
    private readonly store: FileStore,
    private readonly getProvider: (name: string) => {
      adapter: SandboxAdapter;
      capabilities: Capabilities;
    },
    private readonly authorize: AuthorizeSandbox,
  ) {
    if (typeof store.authorizePath !== "function")
      throw new Error("File path policy required");
  }

  private async prepare(
    input: FileRequest,
    operation: FileOperation,
    options: { maxBytes?: number; direction?: "download" | "upload" } = {},
  ) {
    const sandbox = Object.freeze({
      scope: input.sandbox.scope,
      key: input.sandbox.key,
    });
    if (
      typeof sandbox.scope !== "string" ||
      typeof sandbox.key !== "string" ||
      !sandbox.scope ||
      !sandbox.key
    )
      throw new Error("Invalid sandbox identity");
    const path = filePath(input.path);
    const found = await this.store.getSandbox(sandbox);
    if (
      !found ||
      found.tombstone ||
      found.scope !== sandbox.scope ||
      found.key !== sandbox.key
    )
      this.stale(false);
    const row = { ...found, reference: Object.freeze({ ...found.reference }) };
    await this.authorize(
      Object.freeze({ sandbox, reference: row.reference, operation }),
    );
    const provider = this.getProvider(row.reference.provider);
    requireCapability(provider.capabilities, operation);
    const sdk = provider.adapter.files;
    const method = {
      readFile: "read",
      writeFile: "write",
      listFiles: "list",
      deleteFile: "delete",
      transferFile: "transfer",
    } as const;
    if (
      !sdk ||
      typeof sdk[method[operation]] !== "function" ||
      (options.direction &&
        !sdk.transferDirections?.includes(options.direction))
    )
      throw new SandboxProviderError({
        code: "unsupported",
        capability: operation,
        outcome: "not_started",
        retryable: false,
      });
    if (
      options.maxBytes !== undefined &&
      options.maxBytes >
        (provider.capabilities.limits?.maxFileBytes ?? Infinity)
    )
      throw new Error("File limit exceeded");
    const policy = Object.freeze({
      sandbox,
      reference: row.reference,
      operation,
      path,
      ...options,
    });
    if ((await this.store.authorizePath(policy)) !== true)
      throw new SandboxProviderError({
        code: "authorization",
        capability: operation,
        outcome: "not_started",
        retryable: false,
      });
    await this.current(sandbox, row, false);
    return { sandbox, row, path, sdk, policy };
  }

  private stale(mutated: boolean): never {
    throw new SandboxProviderError({
      code: "stale_resource",
      outcome: mutated ? "unknown" : "not_started",
      retryable: false,
    });
  }
  private async current(
    sandbox: SandboxKey,
    row: RegistryRecord,
    mutated: boolean,
  ) {
    const now = await this.store.getSandbox(sandbox);
    if (
      !now ||
      now.tombstone ||
      now.scope !== sandbox.scope ||
      now.key !== sandbox.key ||
      now.generation !== row.generation ||
      now.reference.provider !== row.reference.provider ||
      now.reference.providerId !== row.reference.providerId
    )
      this.stale(mutated);
  }
  private operationId(value: string): string {
    if (
      typeof value !== "string" ||
      !value ||
      value.length > 256 ||
      hasControls(value)
    )
      throw new Error("Invalid file operation ID");
    return value;
  }
  private async call<T>(
    prepared: Awaited<ReturnType<SandboxFiles["prepare"]>>,
    key: string,
    mutated: boolean,
    fn: (
      sdk: FileAdapter,
      context: { idempotencyKey: string; signal: AbortSignal },
    ) => Promise<T>,
  ): Promise<T> {
    const idempotencyKey = JSON.stringify([
      "files",
      prepared.sandbox.scope,
      prepared.sandbox.key,
      prepared.row.generation,
      prepared.policy.operation,
      prepared.policy.direction ?? null,
      prepared.path,
      key,
    ]);
    const result = await boundedSDK((signal) =>
      fn(prepared.sdk, { idempotencyKey, signal }),
    );
    await this.current(prepared.sandbox, prepared.row, mutated);
    return result;
  }

  async read(input: FileReadRequest): Promise<FileRead> {
    const offset = integer(input.offset ?? 0, 0, Number.MAX_SAFE_INTEGER);
    const maxBytes = integer(input.maxBytes ?? 65536, 1, INLINE_FILE_LIMIT);
    integer(offset + maxBytes, 0, Number.MAX_SAFE_INTEGER);
    const prepared = await this.prepare(input, "readFile", { maxBytes });
    const raw = await this.call(
      prepared,
      `${offset}:${maxBytes}`,
      false,
      (sdk, context) =>
        fileMethod(sdk, "read")(
          prepared.row.reference.providerId,
          prepared.path,
          { offset, maxBytes },
          context,
        ),
    );
    if (
      !raw ||
      raw.offset !== offset ||
      typeof raw.complete !== "boolean" ||
      !(raw.data instanceof ArrayBuffer || raw.data instanceof Uint8Array)
    )
      throw new Error("Invalid file read");
    const length = raw.data.byteLength;
    if (raw.totalBytes !== undefined)
      integer(
        raw.totalBytes,
        offset + length,
        Number.MAX_SAFE_INTEGER,
        "Invalid file read",
      );
    const bytesRead = Math.min(length, maxBytes);
    const view =
      raw.data instanceof Uint8Array ? raw.data : new Uint8Array(raw.data);
    const data = new Uint8Array(view.subarray(0, bytesRead)).buffer;
    const truncated =
      !raw.complete ||
      length > maxBytes ||
      (raw.totalBytes !== undefined && offset + bytesRead < raw.totalBytes);
    if (truncated && bytesRead === 0) throw new Error("Invalid file read");
    return {
      data,
      offset,
      bytesRead,
      ...(raw.totalBytes !== undefined ? { totalBytes: raw.totalBytes } : {}),
      truncated,
      nextOffset: truncated ? offset + bytesRead : null,
    };
  }
  async readText(input: FileReadRequest): Promise<FileTextRead> {
    const { data, ...result } = await this.read(input);
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        data,
        { stream: result.truncated },
      );
    } catch {
      throw new Error("Invalid UTF-8 file");
    }
    const bytesRead = new TextEncoder().encode(text).byteLength;
    if (result.truncated && bytesRead === 0)
      throw new Error(
        "Text read limit cannot contain the next UTF-8 character",
      );
    return {
      ...result,
      text,
      bytesRead,
      nextOffset: result.truncated ? result.offset + bytesRead : null,
    };
  }
  async write(input: FileWriteRequest) {
    if (!(input.data instanceof ArrayBuffer))
      throw new Error("Invalid file data");
    integer(input.data.byteLength, 0, INLINE_FILE_LIMIT);
    const data = binaryCopy(input.data),
      operationId = this.operationId(input.operationId);
    const prepared = await this.prepare(input, "writeFile", {
      maxBytes: data.byteLength,
    });
    const raw = await this.call(prepared, operationId, true, (sdk, context) =>
      fileMethod(sdk, "write")(
        prepared.row.reference.providerId,
        prepared.path,
        data,
        context,
      ),
    );
    if (!raw || typeof raw.complete !== "boolean")
      throw new Error("Invalid file write");
    integer(raw.bytesWritten, 0, data.byteLength, "Invalid file write");
    if (raw.complete && raw.bytesWritten !== data.byteLength)
      throw new Error("Invalid file write");
    return { bytesWritten: raw.bytesWritten, partial: !raw.complete };
  }
  async writeText(input: FileTextWriteRequest) {
    if (typeof input.text !== "string" || input.text.length > INLINE_FILE_LIMIT)
      throw new Error("File limit exceeded");
    return this.write({
      sandbox: input.sandbox,
      path: input.path,
      operationId: input.operationId,
      data: new TextEncoder().encode(input.text).buffer,
    });
  }
  async delete(input: FileRequest & { operationId: string }) {
    const operationId = this.operationId(input.operationId);
    const prepared = await this.prepare(input, "deleteFile");
    const raw = await this.call(prepared, operationId, true, (sdk, context) =>
      fileMethod(sdk, "delete")(
        prepared.row.reference.providerId,
        prepared.path,
        context,
      ),
    );
    if (!raw || typeof raw.deleted !== "boolean")
      throw new Error("Invalid file deletion");
    return { deleted: raw.deleted };
  }
  async list(input: FileListRequest): Promise<FileList> {
    const limit = integer(input.limit ?? 50, 1, 100),
      cursor = fileCursor(input.cursor ?? null);
    const prepared = await this.prepare(input, "listFiles");
    const raw = await this.call(
      prepared,
      JSON.stringify([cursor, limit]),
      false,
      (sdk, context) =>
        fileMethod(sdk, "list")(
          prepared.row.reference.providerId,
          prepared.path,
          { cursor, maxEntries: limit },
          context,
        ),
    );
    if (
      !raw ||
      !Array.isArray(raw.entries) ||
      typeof raw.complete !== "boolean"
    )
      throw new Error("Invalid file listing");
    const nextCursor = fileCursor(raw.nextCursor);
    if (raw.complete && nextCursor !== null)
      throw new Error("Invalid file listing");
    const result: FileList = {
      entries: [],
      nextCursor,
      partial: !raw.complete || raw.entries.length > limit,
    };
    for (const entry of raw.entries.slice(0, limit)) {
      if (
        !entry ||
        typeof entry.name !== "string" ||
        !entry.name ||
        entry.name.includes("/") ||
        !["file", "directory", "symlink", "other"].includes(entry.kind)
      )
        throw new Error("Invalid file listing");
      const path = filePath(
        `${prepared.path === "/" ? "" : prepared.path}/${entry.name}`,
      );
      if (entry.sizeBytes !== undefined)
        integer(
          entry.sizeBytes,
          0,
          Number.MAX_SAFE_INTEGER,
          "Invalid file listing",
        );
      if (
        (await this.store.authorizePath(
          Object.freeze({ ...prepared.policy, path, entryKind: entry.kind }),
        )) !== true
      ) {
        result.partial = true;
        continue;
      }
      result.entries.push({
        name: entry.name,
        path,
        kind: entry.kind,
        ...(entry.sizeBytes !== undefined
          ? { sizeBytes: entry.sizeBytes }
          : {}),
      });
    }
    await this.current(prepared.sandbox, prepared.row, false);
    return result;
  }
  async transfer(input: FileTransferRequest) {
    const direction = input.direction,
      operationId = this.operationId(input.operationId);
    if (direction !== "upload" && direction !== "download")
      throw new Error("Invalid transfer direction");
    const expiresInMs = integer(input.expiresInMs ?? 60000, 1, 300000);
    const maxBytes = integer(
      input.maxBytes ?? INLINE_FILE_LIMIT,
      1,
      1073741824,
    );
    const prepared = await this.prepare(input, "transferFile", {
      maxBytes,
      direction,
    });
    const deadline = Date.now() + expiresInMs;
    const raw = await this.call(prepared, operationId, true, (sdk, context) =>
      fileMethod(sdk, "transfer")(
        prepared.row.reference.providerId,
        prepared.path,
        { direction, expiresInMs, maxBytes },
        context,
      ),
    );
    return transferHandle(raw, direction, deadline, maxBytes);
  }
}

function fileMethod<K extends Exclude<keyof FileAdapter, "transferDirections">>(
  sdk: FileAdapter,
  name: K,
): NonNullable<FileAdapter[K]> {
  const method = sdk[name];
  if (typeof method !== "function")
    throw new SandboxProviderError({
      code: "unsupported",
      outcome: "not_started",
      retryable: false,
    });
  return method.bind(sdk) as NonNullable<FileAdapter[K]>;
}
