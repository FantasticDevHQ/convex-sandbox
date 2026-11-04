import type { ExecutionAdapter, ProviderLogPage } from "../execution.js";
import { decode, identity, invalid } from "./protocol.js";
import type { createBoatTransport } from "./transport.js";

const integer = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
async function cursorIdentity(providerId: string, executionId: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify(["boat-history-logs-v1", providerId, executionId]),
    ),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
function offsets(cursor: string | null, key: string): [number, number] {
  if (cursor === null) return [0, 0];
  try {
    if (typeof cursor !== "string" || cursor.length > 256)
      throw invalid("read");
    const value: unknown = JSON.parse(cursor);
    if (
      !Array.isArray(value) ||
      value.length !== 4 ||
      value[0] !== 1 ||
      value[1] !== key ||
      !integer(value[2]) ||
      !integer(value[3])
    )
      throw invalid("read");
    return [value[2], value[3]];
  } catch {
    throw invalid("read");
  }
}
// Leave an unfinished UTF-8 suffix at its native offset for the next read.
// No output bytes are retained in the cursor or adapter memory.
function prefixLength(bytes: Uint8Array) {
  for (let length = 1; length <= Math.min(3, bytes.length); length++) {
    const start = bytes.length - length,
      lead = bytes[start];
    const expected =
      lead >= 0xc2 && lead <= 0xdf
        ? 2
        : lead >= 0xe0 && lead <= 0xef
          ? 3
          : lead >= 0xf0 && lead <= 0xf4
            ? 4
            : 0;
    if (expected <= length) continue;
    const tail = bytes.subarray(start + 1);
    if (!tail.every((byte) => byte >= 0x80 && byte <= 0xbf)) continue;
    const second = tail[0];
    if (
      second !== undefined &&
      ((lead === 0xe0 && second < 0xa0) ||
        (lead === 0xed && second > 0x9f) ||
        (lead === 0xf0 && second < 0x90) ||
        (lead === 0xf4 && second > 0x8f))
    )
      continue;
    return start;
  }
  return bytes.length;
}

export function createBoatLogs(
  transport: ReturnType<typeof createBoatTransport>,
): NonNullable<ExecutionAdapter["logs"]> {
  return async (providerId, executionId, request, context) => {
    identity(providerId);
    identity(executionId);
    // Two entries, at most 1024 native bytes each. Invalid UTF-8 can expand
    // each byte to a three-byte replacement character; budget for that upfront.
    if (
      !integer(request.maxEntries) ||
      request.maxEntries < 2 ||
      request.maxEntries > 16 ||
      !integer(request.maxBytes) ||
      request.maxBytes < 24 ||
      request.maxBytes > 16384
    )
      throw invalid("read");
    const limit = Math.min(1024, Math.floor(request.maxBytes / 6));
    const key = await cursorIdentity(providerId, executionId);
    const positions = offsets(request.cursor, key);
    return transport.call("read", context, async (api, init) => {
      const page: ProviderLogPage = {
        entries: [],
        nextCursor: null,
        complete: true,
        truncated: false,
      };
      for (const [index, stream] of (["stdout", "stderr"] as const).entries()) {
        const requested = positions[index];
        const reply = await decode(
          api.commandLogsRaw(
            {
              sandboxId: providerId,
              commandId: executionId,
              stream,
              offset: requested,
              limit,
              encoding: "base64",
            },
            init,
          ),
          "read",
        );
        if (
          reply.commandId !== executionId ||
          reply.stream !== stream ||
          reply.encoding !== "base64" ||
          !integer(reply.offset) ||
          !integer(reply.nextOffset) ||
          !integer(reply.size) ||
          reply.offset < requested ||
          reply.nextOffset < reply.offset ||
          reply.nextOffset > reply.size ||
          typeof reply.done !== "boolean" ||
          (reply.done && reply.nextOffset !== reply.size) ||
          typeof reply.data !== "string" ||
          reply.data.length > 4 * Math.ceil(limit / 3) ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
            reply.data,
          )
        )
          throw invalid("read");
        const binary = atob(reply.data);
        if (
          btoa(binary) !== reply.data ||
          binary.length > limit ||
          reply.nextOffset - reply.offset !== binary.length
        )
          throw invalid("read");
        const bytes = Uint8Array.from(binary, (character) =>
          character.charCodeAt(0),
        );
        const consumed = reply.done ? bytes.length : prefixLength(bytes);
        const prefix = bytes.subarray(0, consumed);
        let text: string;
        try {
          text = new TextDecoder("utf-8", {
            fatal: true,
            ignoreBOM: true,
          }).decode(prefix);
        } catch {
          text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(prefix);
          page.truncated = true;
        }
        if (text) page.entries.push({ stream, text });
        page.truncated ||= reply.offset > requested;
        positions[index] = reply.offset + consumed;
        page.complete &&= reply.done;
      }
      page.nextCursor = JSON.stringify([1, key, ...positions]);
      return page;
    });
  };
}
