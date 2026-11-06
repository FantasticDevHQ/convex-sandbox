import { createBoatProvider } from "@fantastic.dev/convex-sandbox/boat";
import {
  createSimulatedProvider,
  type ConformanceStores,
  type ConformanceFixture,
} from "@fantastic.dev/convex-sandbox/testing";
import type {
  CommandInput,
  ProviderCallContext,
  SandboxKey,
} from "@fantastic.dev/convex-sandbox";

const root = "/tmp/boat-conformance";
const instructions: Record<string, CommandInput> = {
  "fixture:complete": {
    kind: "argv",
    executable: "fixture",
    args: ["echo", "conformance"],
  },
  "fixture:running": {
    kind: "argv",
    executable: "fixture",
    args: ["progress", "4", "conformance"],
  },
  "fixture:large": {
    kind: "argv",
    executable: "fixture",
    args: ["generate", "100000"],
  },
};
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing baseline fixture method");
  return value;
}
function base64(bytes: Uint8Array) {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}
const json = (body: unknown) =>
  new Response(JSON.stringify({ ok: true, ...(body as object) }));
const nativeState = (state: string) =>
  state === "running" ? "ready" : state === "stopped" ? "archived" : state;

/** Synthetic wire shapes backed by the existing baseline interpreter, never OS/network. */
export function boatConformanceFixture(
  stores: ConformanceStores,
  sandbox: SandboxKey,
): ConformanceFixture {
  const engine = createSimulatedProvider({ profile: "persistent" });
  const sdk = engine.provider.adapter;
  let requestIndex = 0;
  const deletionJobs = new Map<string, string>();
  const nativePath = (path: string) => {
    if (path !== root && !path.startsWith(`${root}/`))
      throw new Error("Unexpected fixture path");
    return `/workspace${path.slice(root.length)}`;
  };
  const provider = createBoatProvider({
    apiKey: "synthetic-conformance-key",
    fetch: async (url, init = {}) => {
      const u = new URL(String(url));
      const method = init.method ?? "GET";
      const requireMethod = (expected: string) => {
        if (method !== expected)
          throw new Error("Unexpected fixture HTTP method");
      };
      if (u.origin !== "https://boat.dev" || !u.pathname.startsWith("/api/v1/"))
        throw new Error("Unexpected fixture API origin");
      const parts = u.pathname
        .slice("/api/v1/".length)
        .split("/")
        .map(decodeURIComponent);
      const body = init.body ? JSON.parse(String(init.body)) : {};
      const context: ProviderCallContext = {
        idempotencyKey:
          new Headers(init.headers).get("Idempotency-Key") ??
          `fixture-request-${++requestIndex}`,
        signal: init.signal ?? new AbortController().signal,
      };
      if (parts[0] === "saved-snapshots") {
        requireMethod("GET");
        return json({ snapshots: [] });
      }
      if (parts[0] === "deletion-operations") {
        requireMethod("GET");
        const targetId =
          parts.length === 2 ? deletionJobs.get(parts[1]) : undefined;
        if (!targetId) throw new Error("Unknown fixture deletion job");
        return json({
          operation: {
            id: parts[1],
            targetId,
            kind: "sandbox",
            status: "completed",
          },
        });
      }
      if (parts[0] !== "sandboxes") throw new Error("Unexpected fixture route");
      const id = parts[1];
      if (!id) {
        requireMethod("POST");
        const result = await required(sdk.create)({}, context);
        return json({
          sandbox: { id: result.providerId, state: nativeState(result.state) },
        });
      }
      if (parts[2] === "resume") {
        requireMethod("POST");
        await required(sdk.start)(id, context);
        return json({ id, sandbox: { id, state: "provisioning" } });
      }
      if (parts[2] === "stop") {
        requireMethod("POST");
        await required(sdk.stop)(id, context);
        return json({ id, stop: { id: `stop-${id}`, status: "completed" } });
      }
      if (parts[2] === "stops") {
        requireMethod("GET");
        return json({ id, stop: { id: parts[3], status: "completed" } });
      }
      if (parts[2] === "fork") {
        requireMethod("POST");
        const images = required(sdk.images);
        let result = await required(images.fork)(id, context);
        if (result.state === "pending")
          result = await required(images.status)(
            id,
            result.operationId,
            context,
          );
        if (result.state !== "ready" || !("machine" in result.result))
          throw new Error("Invalid baseline fork fixture");
        return json({
          id: result.result.machine.providerId,
          sandbox: {
            id: result.result.machine.providerId,
            state: "provisioning",
          },
        });
      }
      if (parts[2] === "commands") {
        requireMethod("POST");
        if (
          body.detached !== true ||
          body.stream !== false ||
          !Object.hasOwn(instructions, body.command)
        )
          throw new Error("Unexpected fixture command request");
        const instruction = instructions[body.command];
        if (!instruction)
          throw new Error("Unexpected fixture command sentinel");
        const result = await required(required(sdk.execution).start)(
          id,
          instruction,
          context,
        );
        return json({
          type: "command.started",
          success: true,
          commandId: result.executionId,
        });
      }
      if (parts[2] === "command-history") {
        requireMethod("GET");
        const execution = required(sdk.execution);
        const result = await execution.status(id, parts[3], context);
        const job = required(
          engine
            .snapshot()
            .machines.find((machine) => machine.id === id)
            ?.executions.find((job) => job.id === parts[3]),
        );
        if (parts[4] !== "logs")
          return json({
            command: {
              commandId: result.executionId,
              sandboxId: id,
              mode: "detached",
              status: result.state === "completed" ? "exited" : "running",
              exitCode: result.exitCode ?? null,
            },
          });
        const stream = u.searchParams.get("stream");
        if (stream !== "stdout" && stream !== "stderr")
          throw new Error("Unexpected fixture stream");
        const bytes = new TextEncoder().encode(job[stream]),
          offset = Number(u.searchParams.get("offset")),
          end = Math.min(
            bytes.length,
            offset + Number(u.searchParams.get("limit")),
          );
        return json({
          commandId: parts[3],
          stream,
          offset,
          nextOffset: end,
          size: bytes.length,
          encoding: "base64",
          data: base64(bytes.slice(offset, end)),
          done: result.state === "completed" && end === bytes.length,
        });
      }
      if (parts[2] === "files") {
        const files = required(sdk.files),
          path = body.path ?? u.searchParams.get("path"),
          mapped = nativePath(path);
        if (parts[3] === "list") {
          requireMethod("GET");
          const result = await required(files.list)(
            id,
            mapped,
            { cursor: null, maxEntries: 100 },
            context,
          );
          return json({
            success: true,
            path,
            truncated: !result.complete,
            files: result.entries.map((entry) => ({
              name: entry.name,
              path: `${path}/${entry.name}`,
              isDir: entry.kind === "directory",
              isSymlink: entry.kind === "symlink",
              size: entry.sizeBytes ?? 0,
            })),
          });
        }
        if (parts[3] !== undefined)
          throw new Error("Unexpected fixture file route");
        if (init.method === "PUT") {
          const bytes = Uint8Array.from(atob(body.content), (character) =>
            character.charCodeAt(0),
          );
          await required(files.write)(id, mapped, bytes.buffer, context);
          return json({
            success: true,
            path: `../..${path}`,
            encoding: "base64",
            size: bytes.length,
          });
        }
        if (init.method === "DELETE") {
          await required(files.delete)(id, mapped, context);
          return json({ success: true, path });
        }
        requireMethod("GET");
        const result = await required(files.read)(
          id,
          mapped,
          { offset: 0, maxBytes: 65536 },
          context,
        );
        const bytes =
          result.data instanceof Uint8Array
            ? result.data
            : new Uint8Array(result.data);
        return json({
          success: true,
          path: `../..${path}`,
          encoding: "base64",
          size: bytes.length,
          content: base64(bytes),
        });
      }
      if (parts.length !== 2)
        throw new Error("Unexpected fixture sandbox route");
      if (init.method === "DELETE") {
        await required(sdk.delete)(id, context);
        deletionJobs.set(`delete-${id}`, id);
        return json({
          operation: {
            id: `delete-${id}`,
            targetId: id,
            kind: "sandbox",
            status: "completed",
          },
        });
      }
      requireMethod("GET");
      const result = await sdk.describe(id, context);
      return json({ sandbox: { id, state: nativeState(result.state) } });
    },
  });
  return {
    provider,
    stores,
    sandbox,
    fileRoot: root,
    pollBudget: 32,
    commands: {
      complete: { kind: "shell", command: "fixture:complete" },
      running: { kind: "shell", command: "fixture:running" },
      largeOutput: { kind: "shell", command: "fixture:large" },
    },
    expectedOutput: "conformance\n",
    cleanup: async () => {
      for (const machine of engine.snapshot().machines)
        if (machine.state !== "deleted")
          await required(sdk.delete)(machine.id, {
            idempotencyKey: `cleanup-${machine.id}`,
            signal: new AbortController().signal,
          });
    },
  };
}
