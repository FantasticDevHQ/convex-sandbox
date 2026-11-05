import { SandboxProviderError } from "../client/errors.js";
import { filePath } from "../client/fileProtocol.js";
import type { FileAdapter, FileEntry } from "../files.js";
import { decodeBase64, encodeBase64 } from "./encoding.js";
import { decode, identity, invalid, object, type Effect } from "./protocol.js";
import type { createBoatTransport } from "./transport.js";

export const BOAT_INLINE_FILE_LIMIT = 65536;
const integer = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const unsupported = (
  capability: "readFile" | "writeFile" | "listFiles" | "deleteFile",
) =>
  new SandboxProviderError({
    code: "unsupported",
    capability,
    outcome: "not_started",
    retryable: false,
  });
function pathInput(raw: string, capability: Parameters<typeof unsupported>[0]) {
  let path: string;
  try {
    path = filePath(raw);
    encodeURIComponent(path);
  } catch {
    throw new SandboxProviderError({
      code: "validation",
      outcome: "not_started",
      retryable: false,
    });
  }
  if (!(
    path === "/home/user" ||
    path.startsWith("/home/user/") ||
    path === "/tmp" ||
    path.startsWith("/tmp/")
  ))
    throw unsupported(capability);
  return path;
}
function confirmed(
  reply: Record<string, unknown>,
  path: string,
  effect: Effect,
  allowWorkdirRelative = false,
) {
  // Native reads/writes can echo a path relative to the documented /home/user.
  // Accept only the one exact equivalent spelling, never arbitrary traversal.
  const relative = !allowWorkdirRelative
    ? undefined
    : path.startsWith("/tmp/")
      ? `../..${path}`
      : path.startsWith("/home/user/")
        ? path.slice("/home/user/".length)
        : undefined;
  if (
    reply.success !== true ||
    (reply.path !== path && (relative === undefined || reply.path !== relative))
  )
    throw invalid(effect);
}

/** Whole-file native API only. Host wrappers own authorization and path policy. */
export function createBoatFiles(
  transport: ReturnType<typeof createBoatTransport>,
): FileAdapter {
  return {
    async read(providerId, rawPath, request, context) {
      identity(providerId);
      const path = pathInput(rawPath, "readFile"),
        { offset, maxBytes } = request;
      if (
        !integer(offset) ||
        !integer(maxBytes) ||
        maxBytes < 1 ||
        maxBytes > BOAT_INLINE_FILE_LIMIT
      )
        throw invalid("read");
      return transport.call("read", context, async (api, init) => {
        const reply = await decode(
          api.readFileRaw(
            { sandboxId: providerId, path, encoding: "base64" },
            init,
          ),
          "read",
        );
        confirmed(reply, path, "read", true);
        if (
          reply.encoding !== "base64" ||
          !integer(reply.size) ||
          reply.size > BOAT_INLINE_FILE_LIMIT ||
          offset > reply.size
        )
          throw invalid("read");
        const bytes = decodeBase64(
          reply.content,
          BOAT_INLINE_FILE_LIMIT,
          "read",
        );
        if (bytes.length !== reply.size) throw invalid("read");
        const end = Math.min(bytes.length, offset + maxBytes);
        return {
          data: bytes.slice(offset, end),
          offset,
          totalBytes: bytes.length,
          complete: end === bytes.length,
        };
      });
    },
    async write(providerId, rawPath, data, context) {
      identity(providerId);
      const path = pathInput(rawPath, "writeFile");
      if (
        !(data instanceof ArrayBuffer) ||
        data.byteLength > BOAT_INLINE_FILE_LIMIT
      )
        throw new SandboxProviderError({
          code: "validation",
          outcome: "not_started",
          retryable: false,
        });
      const bytes = new Uint8Array(data.slice(0));
      const content = encodeBase64(bytes);
      return transport.call("write", context, async (api, init) => {
        const reply = await decode(
          api.writeFileRaw(
            {
              sandboxId: providerId,
              fileWriteRequest: { path, content, encoding: "base64" },
            },
            init,
          ),
          "write",
        );
        confirmed(reply, path, "write", true);
        if (reply.encoding !== "base64" || reply.size !== bytes.length)
          throw invalid("write");
        return { bytesWritten: bytes.length, complete: true };
      });
    },
    async list(providerId, rawPath, request, context) {
      identity(providerId);
      const path = pathInput(rawPath, "listFiles");
      if (request.cursor !== null) throw unsupported("listFiles");
      const { maxEntries } = request;
      if (!integer(maxEntries) || maxEntries < 1 || maxEntries > 100)
        throw invalid("read");
      return transport.call("read", context, async (api, init) => {
        const reply = await decode(
          api.listFilesRaw({ sandboxId: providerId, path }, init),
          "read",
        );
        confirmed(reply, path, "read");
        if (
          !Array.isArray(reply.files) ||
          reply.files.length > 10000 ||
          typeof reply.truncated !== "boolean"
        )
          throw invalid("read");
        const entries: FileEntry[] = [];
        const names = new Set<string>();
        for (const raw of reply.files.slice(0, maxEntries)) {
          const entry = object(raw);
          if (
            !entry ||
            typeof entry.name !== "string" ||
            !entry.name ||
            entry.name.includes("/") ||
            typeof entry.isDir !== "boolean" ||
            typeof entry.isSymlink !== "boolean" ||
            !integer(entry.size) ||
            names.has(entry.name)
          )
            throw invalid("read");
          let child: string;
          try {
            child = filePath(`${path}/${entry.name}`);
          } catch {
            throw invalid("read");
          }
          if (entry.path !== child) throw invalid("read");
          names.add(entry.name);
          entries.push({
            name: entry.name,
            kind: entry.isSymlink
              ? "symlink"
              : entry.isDir
                ? "directory"
                : "file",
            sizeBytes: entry.size,
          });
        }
        return {
          entries,
          nextCursor: null,
          complete: !reply.truncated && reply.files.length <= maxEntries,
        };
      });
    },
    async delete(providerId, rawPath, context) {
      identity(providerId);
      const path = pathInput(rawPath, "deleteFile");
      if (path === "/tmp" || path === "/home/user")
        throw unsupported("deleteFile");
      return transport.call("write", context, async (api, init) => {
        const reply = await decode(
          api.deleteFileRaw(
            { sandboxId: providerId, path, recursive: false },
            init,
          ),
          "write",
        );
        confirmed(reply, path, "write");
        return { deleted: true };
      });
    },
    // Native signed URLs have no enforced byte bound. Do not mint or expose
    // handles whose maxBytes would be metadata rather than an actual restriction.
  };
}
