import type { FileTransfer, TransferDirection } from "../files.js";

export function hasControls(value: string): boolean {
  return Array.from(value).some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
  );
}

export const INLINE_FILE_LIMIT = 1048576;
export function integer(
  value: number,
  min: number,
  max: number,
  message = "File limit exceeded",
): number {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(message);
  return value;
}
export function filePath(path: string): string {
  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.length > 4096 ||
    path.includes("\\") ||
    hasControls(path) ||
    /%(?:2e|2f|5c|00)/i.test(path) ||
    path.split("/").some((part) => part === "." || part === "..")
  )
    throw new Error("Invalid file path");
  return `/${path.split("/").filter(Boolean).join("/")}`;
}
export function fileCursor(cursor: string | null): string | null {
  if (
    cursor !== null &&
    (typeof cursor !== "string" ||
      !cursor ||
      cursor.length > 2048 ||
      hasControls(cursor) ||
      /^[a-z][a-z\d+.-]*:\/\//i.test(cursor))
  )
    throw new Error("Invalid file cursor");
  return cursor;
}
export function binaryCopy(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data.slice(0);
  if (data instanceof Uint8Array) return new Uint8Array(data).buffer;
  throw new Error("Invalid file data");
}
export function transferHandle(
  raw: FileTransfer,
  direction: TransferDirection,
  deadline: number,
  maxBytes: number,
): FileTransfer {
  const invalid = () => {
    throw new Error("Invalid transfer handle");
  };
  if (
    !raw ||
    typeof raw !== "object" ||
    typeof raw.url !== "string" ||
    raw.url.length > 16384 ||
    hasControls(raw.url) ||
    raw.url.trim() !== raw.url
  )
    return invalid();
  let url: URL;
  try {
    url = new URL(raw.url);
  } catch {
    return invalid();
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    !Number.isSafeInteger(raw.expiresAt) ||
    raw.expiresAt <= Date.now() ||
    raw.expiresAt > deadline ||
    !Number.isSafeInteger(raw.maxBytes) ||
    raw.maxBytes < 1 ||
    raw.maxBytes > maxBytes ||
    typeof raw.partial !== "boolean" ||
    (direction === "download"
      ? raw.method !== "GET"
      : !["PUT", "POST"].includes(raw.method))
  )
    return invalid();
  const result: FileTransfer = {
    url: raw.url,
    method: raw.method,
    expiresAt: raw.expiresAt,
    maxBytes: raw.maxBytes,
    partial: raw.partial,
  };
  if (raw.totalBytes !== undefined) {
    if (!Number.isSafeInteger(raw.totalBytes) || raw.totalBytes < 0)
      return invalid();
    result.totalBytes = raw.totalBytes;
    result.partial ||= raw.totalBytes > raw.maxBytes;
  }
  if (raw.headers !== undefined) {
    if (
      !raw.headers ||
      typeof raw.headers !== "object" ||
      Array.isArray(raw.headers)
    )
      return invalid();
    const entries = Object.entries(raw.headers);
    if (
      entries.length > 16 ||
      entries.reduce(
        (size, [key, value]) =>
          size +
          key.length +
          (typeof value === "string" ? value.length : 16385),
        0,
      ) > 16384
    )
      return invalid();
    const headers: Record<string, string> = {};
    let headerBytes = 0;
    for (const [key, value] of entries) {
      if (
        !/^[!#$%&'*+.^_`|~\da-z-]+$/i.test(key) ||
        typeof value !== "string" ||
        hasControls(value)
      )
        return invalid();
      headerBytes += key.length + new TextEncoder().encode(value).byteLength;
      if (headerBytes > 16384) return invalid();
      Object.defineProperty(headers, key, { value, enumerable: true });
    }
    result.headers = headers;
  }
  return result;
}
