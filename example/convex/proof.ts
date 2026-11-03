import {
  SandboxBoundary,
  SandboxProviders,
  registerProvider,
  createLifecycleStore,
  createExecutionStore,
  createFileStore,
  createImageStore,
} from "@fantastic.dev/convex-sandbox";
import type { ComponentApi } from "@fantastic.dev/convex-sandbox/_generated/component.js";
import { internalAction, internalQuery } from "./_generated/server.js";
import { components } from "./_generated/api.js";
import { v } from "convex/values";

const sandbox: ComponentApi = components.sandbox;
const observationFields = {
  scope: v.string(),
  key: v.string(),
  provider: v.string(),
  providerId: v.string(),
  state: v.union(v.literal("running"), v.literal("stopped")),
};

// Server-only synthetic proof. This is not a public, unauthenticated sandbox API.
const boundary = new SandboxBoundary({
  simulated: {
    describe: async (id) => ({
      id,
      state: "running",
      token: "synthetic-not-a-credential",
    }),
  },
});

export const observe = internalAction({
  args: {},
  returns: v.object(observationFields),
  handler: async (ctx) =>
    boundary.observe(
      {
        scope: "internal-fixture",
        key: "proof",
        provider: "simulated",
        providerId: "fixture-1",
      },
      async (observation) => {
        await ctx.runMutation(sandbox.observations.record, observation);
      },
    ),
});

export const latest = internalQuery({
  args: {},
  returns: v.union(v.null(), v.object(observationFields)),
  handler: async (ctx) =>
    ctx.runQuery(sandbox.observations.get, {
      scope: "internal-fixture",
      key: "proof",
    }),
});

/** Internal, synthetic host bridge proof. No live provider or public endpoint. */
export const lifecycle = internalAction({
  args: {},
  returns: v.object({
    created: v.boolean(),
    stopped: v.boolean(),
    deleted: v.boolean(),
  }),
  handler: async (ctx) => {
    let state: "running" | "stopped" | "deleted" = "running";
    let creates = 0;
    const providers = new SandboxProviders({
      authorize: async () => {},
      authorizeCreate: async () => {},
    });
    providers.register(
      registerProvider({
        name: "lifecycle-simulated",
        createIdempotency: "none",
        capabilities: {
          version: 1,
          supported: ["create", "describe", "stop", "delete"],
        },
        adapter: {
          describe: async (providerId) => ({ providerId, state }),
          create: async () => {
            creates++;
            return { providerId: "fixture-machine", state };
          },
          stop: async (providerId) => {
            state = "stopped";
            return { providerId, state };
          },
          delete: async (providerId) => {
            state = "deleted";
            return { providerId, state };
          },
        },
      }),
    );
    const client = providers.lifecycle(createLifecycleStore(ctx, sandbox));
    const identity = { scope: "internal-fixture", key: "lifecycle-proof" };
    await client.create({
      sandbox: identity,
      provider: "lifecycle-simulated",
      operationId: "create",
    });
    await client.create({
      sandbox: identity,
      provider: "lifecycle-simulated",
      operationId: "create",
    });
    await client.run({
      sandbox: identity,
      operationId: "stop",
      action: "stop",
    });
    const stopped = (await client.get(identity))?.observedState === "stopped";
    await client.run({
      sandbox: identity,
      operationId: "delete",
      action: "delete",
    });
    return {
      created: creates === 1,
      stopped,
      deleted: (await client.get(identity))?.tombstone === true,
    };
  },
});

/** Synthetic command SDK proof. No shell command runs on the host or a live provider. */
export const execution = internalAction({
  args: {},
  returns: v.object({
    startedOnce: v.boolean(),
    completed: v.boolean(),
    cancelAcknowledged: v.boolean(),
    outputBounded: v.boolean(),
    deleted: v.boolean(),
  }),
  handler: async (ctx) => {
    let starts = 0;
    const providers = new SandboxProviders({
      authorize: async () => {},
      authorizeCreate: async () => {},
    });
    providers.register(
      registerProvider({
        name: "execution-simulated",
        createIdempotency: "none",
        capabilities: {
          version: 1,
          supported: [
            "create",
            "describe",
            "delete",
            "execute",
            "cancelExecution",
            "executionLogs",
          ],
        },
        adapter: {
          describe: async (providerId) => ({ providerId, state: "running" }),
          create: async () => ({
            providerId: "fixture-execution-machine",
            state: "running",
          }),
          delete: async (providerId) => ({ providerId, state: "deleted" }),
          execution: {
            idempotency: "none",
            start: async () => {
              starts++;
              return { executionId: "fixture-command", state: "queued" };
            },
            status: async () => ({
              executionId: "fixture-command",
              state: "completed",
              exitCode: 0,
            }),
            cancel: async () => ({ acknowledged: true }),
            logs: async () => ({
              entries: [{ stream: "stdout", text: "synthetic output" }],
              nextCursor: null,
              complete: true,
            }),
          },
        },
      }),
    );
    const identity = { scope: "internal-fixture", key: "execution-proof" };
    const lifecycle = providers.lifecycle(createLifecycleStore(ctx, sandbox));
    await lifecycle.create({
      sandbox: identity,
      provider: "execution-simulated",
      operationId: "create",
    });
    const client = providers.execution(createExecutionStore(ctx, sandbox));
    const handle = { sandbox: identity, operationId: "command" };
    const input = {
      kind: "argv" as const,
      executable: "printf",
      args: ["synthetic output"],
    };
    await client.start({ ...handle, input });
    await client.start({ ...handle, input });
    await client.syncLogs(handle);
    const cancellation = await client.cancel(handle);
    const completed = await client.status(handle);
    const logs = await client.logs({ ...handle, cursor: null });
    await lifecycle.run({
      sandbox: identity,
      operationId: "delete",
      action: "delete",
    });
    return {
      startedOnce: starts === 1,
      completed: completed?.state === "completed" && completed.exitCode === 0,
      cancelAcknowledged:
        cancellation?.cancellation.acknowledgement === "accepted" &&
        cancellation.state === "queued",
      outputBounded:
        logs.entries.map((entry) => entry.text).join("") ===
          "synthetic output" && (completed?.outputBytes ?? Infinity) <= 65536,
      deleted: (await lifecycle.get(identity))?.tombstone === true,
    };
  },
});

/** In-memory native-file fixture; no real filesystem, bucket or provider access. */
export const files = internalAction({
  args: {},
  returns: v.object({
    text: v.boolean(),
    binary: v.boolean(),
    listed: v.boolean(),
    deleted: v.boolean(),
    transferBounded: v.boolean(),
    denied: v.boolean(),
  }),
  handler: async (ctx) => {
    const identity = { scope: "internal-fixture", key: "files-proof" };
    await ctx.runMutation(sandbox.registry.ensure, {
      sandbox: identity,
      reference: { provider: "files-simulated", providerId: "fixture-files" },
    });
    const data = new Map<string, ArrayBuffer>();
    const providers = new SandboxProviders({ authorize: async () => {} });
    providers.register(
      registerProvider({
        name: "files-simulated",
        capabilities: {
          version: 1,
          supported: [
            "readFile",
            "writeFile",
            "listFiles",
            "deleteFile",
            "transferFile",
          ],
        },
        adapter: {
          describe: async (providerId) => ({ providerId, state: "running" }),
          files: {
            read: async (_, path, request) => {
              const bytes = data.get(path) ?? new ArrayBuffer(0);
              return {
                data: bytes.slice(
                  request.offset,
                  request.offset + request.maxBytes,
                ),
                offset: request.offset,
                totalBytes: bytes.byteLength,
                complete: request.offset + request.maxBytes >= bytes.byteLength,
              };
            },
            write: async (_, path, bytes) => {
              data.set(path, bytes.slice(0));
              return { bytesWritten: bytes.byteLength, complete: true };
            },
            list: async () => ({
              entries: [{ name: "text", kind: "file" }],
              nextCursor: null,
              complete: true,
            }),
            delete: async (_, path) => ({ deleted: data.delete(path) }),
            transferDirections: ["download"],
            transfer: async (_, __, request) => ({
              url: "https://files.example.test/signed?token=synthetic",
              method: "GET",
              expiresAt: Date.now() + request.expiresInMs - 100,
              maxBytes: request.maxBytes,
              partial: false,
            }),
          },
        },
      }),
    );
    const client = providers.files({
      ...createFileStore(ctx, sandbox),
      authorizePath: async ({ path }) =>
        path === "/workspace" || path.startsWith("/workspace/"),
    });
    await client.writeText({
      sandbox: identity,
      path: "/workspace/text",
      text: "synthetic-file-content 🦊",
      operationId: "text",
    });
    const text = await client.readText({
      sandbox: identity,
      path: "/workspace/text",
    });
    await client.write({
      sandbox: identity,
      path: "/workspace/binary",
      data: new Uint8Array([0, 255, 128]).buffer,
      operationId: "binary",
    });
    const binary = await client.read({
      sandbox: identity,
      path: "/workspace/binary",
    });
    const listed = await client.list({ sandbox: identity, path: "/workspace" });
    const transfer = await client.transfer({
      sandbox: identity,
      path: "/workspace/text",
      direction: "download",
      operationId: "transfer",
      maxBytes: 1024,
    });
    let denied = false;
    try {
      await client.read({ sandbox: identity, path: "/private/secret" });
    } catch {
      denied = true;
    }
    return {
      text: text.text === "synthetic-file-content 🦊" && !text.truncated,
      binary: [...new Uint8Array(binary.data)].join(",") === "0,255,128",
      listed: listed.entries[0]?.name === "text" && !listed.partial,
      deleted: (
        await client.delete({
          sandbox: identity,
          path: "/workspace/binary",
          operationId: "delete",
        })
      ).deleted,
      transferBounded:
        transfer.maxBytes === 1024 && transfer.expiresAt <= Date.now() + 60000,
      denied,
    };
  },
});

function imageProviders() {
  const providers = new SandboxProviders({ authorize: async () => {} });
  providers.register(
    registerProvider({
      name: "images-simulated",
      capabilities: {
        version: 1,
        supported: ["snapshotDisk", "getConnection"],
      },
      adapter: {
        describe: async (providerId) => ({ providerId, state: "running" }),
        images: {
          snapshotDisk: async () => ({
            state: "pending",
            operationId: "synthetic-image-job",
          }),
          status: async () => ({
            state: "ready",
            result: {
              image: {
                provider: "images-simulated",
                id: "synthetic-disk-image",
                kind: "disk-snapshot",
              },
            },
          }),
        },
        connections: {
          kinds: ["preview"],
          get: async (_, request) => ({
            kind: "preview",
            url: "https://preview.example.test/signed",
            expiresAt: Date.now() + request.expiresInMs - 100,
            access: { kind: "token", token: "synthetic-connection-secret" },
          }),
        },
      },
    }),
  );
  return providers;
}
const imageIdentity = { scope: "internal-fixture", key: "images-proof" };

/** A pending synthetic native job. A different action resolves it after restart. */
export const images = internalAction({
  args: {},
  returns: v.object({
    pending: v.boolean(),
    connected: v.boolean(),
    unsupportedDesktop: v.boolean(),
  }),
  handler: async (ctx) => {
    await ctx.runMutation(sandbox.registry.ensure, {
      sandbox: imageIdentity,
      reference: { provider: "images-simulated", providerId: "fixture-images" },
    });
    const client = imageProviders().images(createImageStore(ctx, sandbox));
    const op = await client.run({
      sandbox: imageIdentity,
      operationId: "snapshot",
      kind: "snapshotDisk",
    });
    const connection = await client.connection({
      sandbox: imageIdentity,
      kind: "preview",
    });
    let unsupportedDesktop = false;
    try {
      await client.connection({ sandbox: imageIdentity, kind: "desktop" });
    } catch (error) {
      unsupportedDesktop =
        error instanceof Error && error.message === "Unsupported capability";
    }
    return {
      pending:
        op.status === "running" &&
        op.nativeImage?.providerOperationId === "synthetic-image-job",
      connected:
        connection.kind === "preview" && connection.access.kind === "token",
      unsupportedDesktop,
    };
  },
});

export const imageStatus = internalAction({
  args: {},
  returns: v.object({ ready: v.boolean(), nativeIdentity: v.boolean() }),
  handler: async (ctx) => {
    const client = imageProviders().images(createImageStore(ctx, sandbox));
    const record = await client.status({
      sandbox: imageIdentity,
      operationId: "snapshot",
    });
    const result = record?.nativeImage?.result;
    return {
      ready: record?.status === "succeeded",
      nativeIdentity:
        !!result &&
        "image" in result &&
        result.image.provider === "images-simulated" &&
        result.image.id === "synthetic-disk-image",
    };
  },
});
