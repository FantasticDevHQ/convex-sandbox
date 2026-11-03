import { v } from "convex/values";
import type { SandboxKey, ProviderReference } from "./contracts.js";
import type { RegistryRecord } from "./state.js";
import type { ProviderCallContext } from "./lifecycle.js";

export type FileOperation =
  "readFile" | "writeFile" | "listFiles" | "deleteFile" | "transferFile";
export type TransferDirection = "download" | "upload";
export type FileKind = "file" | "directory" | "symlink" | "other";
export interface FileEntry {
  name: string;
  kind: FileKind;
  sizeBytes?: number;
}
export interface FileTransfer {
  url: string;
  method: "GET" | "PUT" | "POST";
  expiresAt: number;
  maxBytes: number;
  partial: boolean;
  headers?: Record<string, string>;
  totalBytes?: number;
}
/** Native SDK implementations only. No shell fallback or automatic retries. */
export interface FileAdapter {
  read?(
    providerId: string,
    path: string,
    request: { offset: number; maxBytes: number },
    context: ProviderCallContext,
  ): Promise<{
    data: ArrayBuffer | Uint8Array;
    offset: number;
    totalBytes?: number;
    complete: boolean;
  }>;
  write?(
    providerId: string,
    path: string,
    data: ArrayBuffer,
    context: ProviderCallContext,
  ): Promise<{ bytesWritten: number; complete: boolean }>;
  list?(
    providerId: string,
    path: string,
    request: { cursor: string | null; maxEntries: number },
    context: ProviderCallContext,
  ): Promise<{
    entries: FileEntry[];
    nextCursor: string | null;
    complete: boolean;
  }>;
  delete?(
    providerId: string,
    path: string,
    context: ProviderCallContext,
  ): Promise<{ deleted: boolean }>;
  transferDirections?: readonly TransferDirection[];
  transfer?(
    providerId: string,
    path: string,
    request: {
      direction: TransferDirection;
      expiresInMs: number;
      maxBytes: number;
    },
    context: ProviderCallContext,
  ): Promise<FileTransfer>;
}
/** Runs in the host action for the requested path and every returned child. */
export type FilePathPolicy = (
  input: Readonly<{
    sandbox: Readonly<SandboxKey>;
    reference: Readonly<ProviderReference>;
    operation: FileOperation;
    path: string;
    direction?: TransferDirection;
    maxBytes?: number;
    entryKind?: FileKind;
  }>,
) => boolean | Promise<boolean>;
export interface FileStore {
  getSandbox(sandbox: SandboxKey): Promise<RegistryRecord | null>;
  authorizePath: FilePathPolicy;
}
export interface FileRequest {
  sandbox: SandboxKey;
  path: string;
}
export interface FileReadRequest extends FileRequest {
  offset?: number;
  maxBytes?: number;
}
export interface FileRead {
  data: ArrayBuffer;
  offset: number;
  bytesRead: number;
  totalBytes?: number;
  truncated: boolean;
  nextOffset: number | null;
}
export interface FileTextRead extends Omit<FileRead, "data"> {
  text: string;
}
export interface FileWriteRequest extends FileRequest {
  data: ArrayBuffer;
  operationId: string;
}
export interface FileTextWriteRequest extends FileRequest {
  text: string;
  operationId: string;
}
export interface FileListRequest extends FileRequest {
  cursor?: string | null;
  limit?: number;
}
export interface FileList {
  entries: (FileEntry & { path: string })[];
  nextCursor: string | null;
  partial: boolean;
}
export interface FileTransferRequest extends FileRequest {
  direction: TransferDirection;
  operationId: string;
  expiresInMs?: number;
  maxBytes?: number;
}

/** Validators for authenticated host action return values; never reactive storage. */
export const fileReadValidator = v.object({
  data: v.bytes(),
  offset: v.number(),
  bytesRead: v.number(),
  totalBytes: v.optional(v.number()),
  truncated: v.boolean(),
  nextOffset: v.union(v.number(), v.null()),
});
export const fileTextReadValidator = v.object({
  text: v.string(),
  offset: v.number(),
  bytesRead: v.number(),
  totalBytes: v.optional(v.number()),
  truncated: v.boolean(),
  nextOffset: v.union(v.number(), v.null()),
});
export const fileWriteValidator = v.object({
  bytesWritten: v.number(),
  partial: v.boolean(),
});
export const fileDeleteValidator = v.object({ deleted: v.boolean() });
export const fileListValidator = v.object({
  entries: v.array(
    v.object({
      name: v.string(),
      path: v.string(),
      kind: v.union(
        v.literal("file"),
        v.literal("directory"),
        v.literal("symlink"),
        v.literal("other"),
      ),
      sizeBytes: v.optional(v.number()),
    }),
  ),
  nextCursor: v.union(v.string(), v.null()),
  partial: v.boolean(),
});
export const fileTransferValidator = v.object({
  url: v.string(),
  method: v.union(v.literal("GET"), v.literal("PUT"), v.literal("POST")),
  expiresAt: v.number(),
  maxBytes: v.number(),
  partial: v.boolean(),
  headers: v.optional(v.record(v.string(), v.string())),
  totalBytes: v.optional(v.number()),
});
