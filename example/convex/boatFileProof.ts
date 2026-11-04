import { v } from "convex/values";
import { internalAction } from "./_generated/server.js";
import { components } from "./_generated/api.js";
import { createBoatProvider } from "@fantastic.dev/convex-sandbox/boat";
import {
  SandboxProviders,
  createFileStore,
} from "@fantastic.dev/convex-sandbox";

const sandbox = { scope: "boat-file-proof", key: "machine" };
const root = "/tmp/fixture",
  path = `${root}/binary`,
  textPath = `${root}/text`;
const base64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};
// Internal qualification only. All native file data/HTTP are synthetic in memory.
export const runtime = internalAction({
  args: {},
  returns: v.object({
    binary: v.boolean(),
    utf8: v.boolean(),
    bounded: v.boolean(),
    denied: v.boolean(),
    listPartial: v.boolean(),
    deleted: v.boolean(),
    transfersUnsupported: v.boolean(),
    registrySafe: v.boolean(),
  }),
  handler: async (ctx) => {
    let calls = 0;
    const data = new Map<string, Uint8Array>();
    const providers = new SandboxProviders({ authorize: async () => {} });
    providers.register(
      createBoatProvider({
        apiKey: "synthetic-file-proof",
        fetch: async (url, init) => {
          calls++;
          const u = new URL(String(url)),
            body =
              init?.method === "PUT" ? JSON.parse(String(init.body)) : null;
          const requested = body?.path ?? u.searchParams.get("path");
          let reply: Record<string, unknown> = {
            ok: true,
            success: true,
            path: requested,
          };
          if (body) {
            const bytes = Uint8Array.from(atob(body.content), (character) =>
              character.charCodeAt(0),
            );
            data.set(requested, bytes);
            reply = { ...reply, encoding: "base64", size: bytes.length };
          } else if (init?.method === "DELETE") {
            if (u.searchParams.get("recursive") !== "false")
              throw new Error("Unexpected recursive delete");
            data.delete(requested);
          } else if (u.pathname.endsWith("/list")) {
            reply = {
              ...reply,
              truncated: false,
              files: [
                {
                  name: "binary",
                  path,
                  isDir: false,
                  isSymlink: false,
                  size: 65536,
                },
                {
                  name: "hidden",
                  path: `${root}/hidden`,
                  isDir: false,
                  isSymlink: false,
                  size: 1,
                },
              ],
            };
          } else {
            const bytes = data.get(requested) ?? new Uint8Array();
            reply = {
              ...reply,
              encoding: "base64",
              size: bytes.length,
              content: base64(bytes),
            };
          }
          return new Response(JSON.stringify(reply));
        },
      }),
    );
    await ctx.runMutation(components.sandbox.registry.ensure, {
      sandbox,
      reference: { provider: "boat", providerId: "file-proof-vm" },
    });
    const files = providers.files({
      ...createFileStore(ctx, components.sandbox),
      authorizePath: ({ path: candidate }) =>
        [root, path, textPath].includes(candidate),
    });
    const bytes = Uint8Array.from({ length: 65536 }, (_, i) => i % 256);
    const written = await files.write({
      sandbox,
      path,
      operationId: "binary",
      data: bytes.buffer,
    });
    const read = await files.read({ sandbox, path, offset: 254, maxBytes: 4 });
    await files.writeText({
      sandbox,
      path: textPath,
      operationId: "text",
      text: "\ufeffa😀z",
    });
    const text = await files.readText({ sandbox, path: textPath, maxBytes: 6 });
    const tail = await files.readText({
      sandbox,
      path: textPath,
      offset: text.nextOffset ?? 0,
    });
    const beforeDenied = calls;
    let denied = false,
      bounded = false;
    try {
      await files.read({ sandbox, path: `${root}/hidden` });
    } catch {
      denied = calls === beforeDenied;
    }
    try {
      await files.write({
        sandbox,
        path,
        operationId: "oversized",
        data: new ArrayBuffer(65537),
      });
    } catch {
      bounded = calls === beforeDenied;
    }
    const list = await files.list({ sandbox, path: root });
    const removed = await files.delete({
      sandbox,
      path,
      operationId: "delete",
    });
    const beforeTransfer = calls;
    let rejected = 0;
    for (const direction of ["download", "upload"] as const)
      try {
        await files.transfer({
          sandbox,
          path,
          direction,
          operationId: direction,
        });
      } catch {
        rejected++;
      }
    const registry = await ctx.runQuery(components.sandbox.registry.get, {
      sandbox,
    });
    return {
      binary:
        written.bytesWritten === 65536 &&
        !written.partial &&
        Array.from(new Uint8Array(read.data)).join(",") === "254,255,0,1" &&
        read.nextOffset === 258,
      utf8:
        text.text === "\ufeffa" && text.nextOffset === 4 && tail.text === "😀z",
      bounded,
      denied,
      listPartial:
        list.partial && list.nextCursor === null && list.entries.length === 1,
      deleted: removed.deleted && !data.has(path),
      transfersUnsupported: rejected === 2 && calls === beforeTransfer,
      registrySafe:
        registry?.reference.providerId === "file-proof-vm" &&
        !JSON.stringify(registry).includes("synthetic-file-proof") &&
        !JSON.stringify(registry).includes("content"),
    };
  },
});
