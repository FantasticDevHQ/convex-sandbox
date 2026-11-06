import { v } from "convex/values";
import { internalAction, type ActionCtx } from "./_generated/server.js";
import { components } from "./_generated/api.js";
import { createBoatProvider } from "@fantastic.dev/convex-sandbox/boat";
import {
  SandboxProviders,
  createExecutionStore,
} from "@fantastic.dev/convex-sandbox";

const sandbox = { scope: "boat-log-proof", key: "machine" };
const handle = { sandbox, operationId: "command" };
function client(ctx: ActionCtx, terminal: boolean) {
  const calls: URL[] = [];
  const providers = new SandboxProviders({ authorize: async () => {} });
  providers.register(
    createBoatProvider({
      apiKey: "synthetic-log-proof",
      fetch: async (url, init) => {
        const u = new URL(String(url));
        calls.push(u);
        if (init?.method === "POST" && !terminal)
          return new Response(
            JSON.stringify({
              ok: true,
              success: true,
              type: "command.started",
              commandId: "history-log-id",
            }),
          );
        if (
          init?.method !== "GET" ||
          !u.pathname.endsWith(
            "/sandboxes/log-vm/command-history/history-log-id/logs",
          ) ||
          u.searchParams.get("encoding") !== "base64"
        )
          throw new Error("Unexpected synthetic log request");
        const stream = u.searchParams.get("stream"),
          offset = Number(u.searchParams.get("offset"));
        const text =
          stream === "stdout" ? (terminal ? "first second" : "first") : "note";
        const data = text.slice(offset);
        return new Response(
          JSON.stringify({
            ok: true,
            commandId: "history-log-id",
            stream,
            offset,
            nextOffset: text.length,
            size: text.length,
            encoding: "base64",
            data: btoa(data),
            done: true,
          }),
        );
      },
    }),
  );
  return {
    execution: providers.execution(
      createExecutionStore(ctx, components.sandbox),
    ),
    calls,
  };
}
export const accept = internalAction({
  args: {},
  returns: v.object({
    cached: v.boolean(),
    repeatedRead: v.boolean(),
    cancellationUnsupported: v.boolean(),
  }),
  handler: async (ctx) => {
    await ctx.runMutation(components.sandbox.registry.ensure, {
      sandbox,
      reference: { provider: "boat", providerId: "log-vm" },
    });
    const f = client(ctx, false);
    await f.execution.start({
      ...handle,
      input: { kind: "shell", command: "printf synthetic" },
    });
    await f.execution.syncLogs(handle);
    await f.execution.syncLogs(handle);
    let unsupported = false;
    try {
      await f.execution.cancel(handle);
    } catch {
      unsupported = true;
    }
    const logs = await f.execution.logs({ ...handle, cursor: null });
    return {
      cached: logs.entries.map((e) => e.text).join("") === "firstnote",
      repeatedRead: f.calls.length === 5,
      cancellationUnsupported:
        unsupported &&
        (await f.execution.get(handle))?.cancellation.acknowledgement ===
          "none" &&
        f.calls.length === 5,
    };
  },
});
export const complete = internalAction({
  args: {},
  returns: v.object({
    noDuplicates: v.boolean(),
    resumedOffsets: v.boolean(),
    notCompletion: v.boolean(),
    cursorReadable: v.boolean(),
  }),
  handler: async (ctx) => {
    const f = client(ctx, true);
    await f.execution.syncLogs(handle);
    const before = f.calls.length;
    await f.execution.syncLogs(handle);
    const logs = await f.execution.logs({ ...handle, cursor: null });
    const record = await f.execution.get(handle);
    return {
      noDuplicates:
        logs.entries
          .filter((e) => e.stream === "stdout")
          .map((e) => e.text)
          .join("") === "first second" &&
        logs.entries
          .filter((e) => e.stream === "stderr")
          .map((e) => e.text)
          .join("") === "note",
      resumedOffsets:
        f.calls.length === 4 &&
        f.calls[0].searchParams.get("offset") === "5" &&
        f.calls[1].searchParams.get("offset") === "4",
      notCompletion: record?.state === "running",
      cursorReadable:
        f.calls.length === before + 2 &&
        f.calls[2].searchParams.get("offset") === "12" &&
        f.calls[3].searchParams.get("offset") === "4" &&
        logs.truncated === false,
    };
  },
});

export const encoding = internalAction({
  args: {},
  returns: v.object({ utf8: v.boolean(), boundaryReread: v.boolean() }),
  handler: async () => {
    let terminal = false;
    const offsets: number[] = [];
    const provider = createBoatProvider({
      apiKey: "synthetic-encoding-proof",
      fetch: async (url) => {
        const u = new URL(String(url)),
          stream = u.searchParams.get("stream"),
          offset = Number(u.searchParams.get("offset"));
        if (stream === "stdout") offsets.push(offset);
        const all =
          stream === "stdout"
            ? new TextEncoder().encode("\ufeff😀")
            : new Uint8Array();
        const available = terminal ? all : all.subarray(0, 5);
        const data = available.subarray(offset);
        return new Response(
          JSON.stringify({
            ok: true,
            commandId: "encoding-id",
            stream,
            offset,
            nextOffset: available.length,
            size: available.length,
            encoding: "base64",
            data: btoa(String.fromCharCode(...data)),
            done: terminal,
          }),
        );
      },
    });
    const logs = provider.adapter.execution?.logs;
    if (!logs) throw new Error("Missing log adapter");
    const context = {
      idempotencyKey: "synthetic-encoding",
      signal: new AbortController().signal,
    };
    const first = await logs(
      "encoding-vm",
      "encoding-id",
      { cursor: null, maxEntries: 16, maxBytes: 16384 },
      context,
    );
    terminal = true;
    const last = await logs(
      "encoding-vm",
      "encoding-id",
      { cursor: first.nextCursor, maxEntries: 16, maxBytes: 16384 },
      context,
    );
    return {
      utf8:
        [...first.entries, ...last.entries].map((e) => e.text).join("") ===
          "\ufeff😀" &&
        !first.truncated &&
        !last.truncated &&
        !last.complete,
      boundaryReread: offsets.join(",") === "0,3",
    };
  },
});
