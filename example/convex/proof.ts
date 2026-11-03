import {
  createSimulatedProvider,
  runAdapterConformance,
} from "@fantastic.dev/convex-sandbox/testing";
import {
  createHostAccess,
  protectExecutionStore,
  protectSecretHandle,
  serializeSandboxError,
} from "@fantastic.dev/convex-sandbox/server";
import {
  SandboxBoundary,
  SandboxProviders,
  SandboxProviderError,
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

/** Fixed internal fixture identities only. Never a browser-selectable auth example. */
export const hostSecurity = internalAction({
  args: {},
  returns: v.object({
    deniedAcrossScopes: v.boolean(),
    deniedListInjection: v.boolean(),
    noUnauthorizedSDKCalls: v.boolean(),
    outputWithheld: v.boolean(),
    safeError: v.boolean(),
    secretHandleBlocked: v.boolean(),
  }),
  handler: async (ctx) => {
    const owned = { scope: "host-fixture-a", key: "owned" },
      foreign = { scope: "host-fixture-b", key: "owned" };
    for (const [identity, providerId] of [
      [owned, "fixture-a"],
      [foreign, "fixture-b"],
    ] as const)
      await ctx.runMutation(sandbox.registry.ensure, {
        sandbox: identity,
        reference: { provider: "host-simulated", providerId },
      });
    const masterKey = "fixture-only-not-a-real-master-key";
    const access = createHostAccess({
      authenticate: async () => ({
        subject: "fixture-subject-a",
        scope: owned.scope,
      }),
      getSandbox: (identity) =>
        ctx.runQuery(sandbox.registry.get, { sandbox: identity }),
      listSandboxes: (scope, page) =>
        ctx.runQuery(sandbox.registry.list, {
          scope,
          paginationOpts: { cursor: page.cursor, numItems: page.limit },
        }),
      authorize: async ({ sandbox }) => sandbox.key === "owned",
      selectProvider: async () => "host-simulated",
      authorizePath: async ({ path }) => path.startsWith("/workspace/"),
    });
    let sdkCalls = 0;
    const providers = new SandboxProviders({
      authorize: access.authorize,
      authorizeCreate: access.authorizeCreate,
    });
    providers.register(
      registerProvider({
        name: "host-simulated",
        capabilities: {
          version: 1,
          supported: [
            "describe",
            "delete",
            "execute",
            "readFile",
            "getConnection",
          ],
        },
        adapter: {
          describe: async () => {
            throw new Error(`private SDK error: ${masterKey}`);
          },
          delete: async (providerId) => {
            sdkCalls++;
            return { providerId, state: "deleted" };
          },
          execution: {
            idempotency: "none",
            start: async () => {
              sdkCalls++;
              return {
                executionId: "fixture-command",
                state: "completed",
                exitCode: 0,
                output: {
                  stdout: `${masterKey} https://signed.example.test/secret`,
                  stderr: "private fixture output",
                  truncated: false,
                },
              };
            },
            status: async () => ({
              executionId: "fixture-command",
              state: "completed",
              exitCode: 0,
            }),
          },
          files: {
            read: async () => {
              sdkCalls++;
              return { data: new ArrayBuffer(0), offset: 0, complete: true };
            },
          },
          connections: {
            kinds: ["preview"],
            get: async (_, request) => {
              sdkCalls++;
              return {
                kind: "preview",
                url: "https://preview.example.test",
                expiresAt: Date.now() + request.expiresInMs - 100,
                access: { kind: "public" },
              };
            },
          },
        },
      }),
    );
    const lifecycle = providers.lifecycle(createLifecycleStore(ctx, sandbox));
    const execution = providers.execution(
      protectExecutionStore(createExecutionStore(ctx, sandbox)),
    );
    const files = providers.files({
      ...createFileStore(ctx, sandbox),
      authorizePath: access.authorizePath,
    });
    const images = providers.images(createImageStore(ctx, sandbox));
    let denied = 0;
    for (const call of [
      () => lifecycle.get(foreign),
      () =>
        lifecycle.run({
          sandbox: foreign,
          operationId: "delete",
          action: "delete",
        }),
      () =>
        execution.start({
          sandbox: foreign,
          operationId: "command",
          input: { kind: "shell", command: "synthetic only" },
        }),
      () => files.read({ sandbox: foreign, path: "/workspace/file" }),
      () => images.connection({ sandbox: foreign, kind: "preview" }),
    ]) {
      try {
        await call();
      } catch (error) {
        if (
          error instanceof SandboxProviderError &&
          error.data.code === "authorization"
        )
          denied++;
      }
    }
    const noUnauthorizedSDKCalls = sdkCalls === 0;
    let deniedListInjection = false;
    try {
      await access.list({ scope: foreign.scope, limit: 10 });
    } catch (error) {
      deniedListInjection =
        error instanceof SandboxProviderError &&
        error.data.code === "validation";
    }
    const resolved = await access.resolve({ key: "owned" }, "execute");
    await execution.start({
      sandbox: resolved.sandbox,
      operationId: "command",
      input: { kind: "shell", command: "synthetic only" },
    });
    const logs = await execution.logs({
      sandbox: owned,
      operationId: "command",
      cursor: null,
    });
    let safeError = false;
    try {
      await providers.describe(
        await access.resolve({ key: "owned" }, "describe"),
      );
    } catch (error) {
      safeError = !JSON.stringify(serializeSandboxError(error)).includes(
        masterKey,
      );
    }
    const validHandle = protectSecretHandle(
      {
        kind: "preview",
        url: "https://preview.example.test/short-lived",
        expiresAt: Date.now() + 1000,
        access: { kind: "token", token: "fixture-session-token" },
      },
      [masterKey],
    );
    let secretHandleBlocked = false;
    try {
      protectSecretHandle(
        {
          kind: "preview",
          url: "https://preview.example.test",
          expiresAt: Date.now() + 1000,
          access: { kind: "token", token: masterKey },
        },
        [masterKey],
      );
    } catch (error) {
      secretHandleBlocked =
        error instanceof SandboxProviderError &&
        error.data.code === "validation" &&
        validHandle.access.token === "fixture-session-token";
    }
    return {
      deniedAcrossScopes: denied === 5,
      deniedListInjection,
      noUnauthorizedSDKCalls,
      outputWithheld: logs.entries.length === 0,
      safeError,
      secretHandleBlocked,
    };
  },
});

/** Public testing API on a real installed component, with isolated fixture keys. */
export const conformance = internalAction({
  args: {},
  returns: v.object({
    passed: v.number(),
    skipped: v.number(),
    total: v.number(),
  }),
  handler: async (ctx) => {
    let index = 0;
    const scope = `internal-conformance-${Date.now()}`;
    const report = await runAdapterConformance(() => {
      const simulated = createSimulatedProvider({ profile: "persistent" });
      return {
        provider: simulated.provider,
        sandbox: { scope, key: `case-${index++}` },
        stores: {
          lifecycle: createLifecycleStore(ctx, sandbox),
          execution: createExecutionStore(ctx, sandbox),
          files: {
            ...createFileStore(ctx, sandbox),
            authorizePath: async ({ path }) =>
              path === "/workspace" || path.startsWith("/workspace/"),
          },
          images: createImageStore(ctx, sandbox),
        },
        commands: {
          complete: {
            kind: "argv",
            executable: "fixture",
            args: ["echo", "conformance"],
          },
          running: {
            kind: "argv",
            executable: "fixture",
            args: ["progress", "4", "conformance"],
          },
          largeOutput: {
            kind: "argv",
            executable: "fixture",
            args: ["generate", "100000"],
          },
        },
        expectedOutput: "conformance\n",
        cleanup: async () => {
          for (const machine of simulated.snapshot().machines)
            if (machine.state !== "deleted")
              await simulated.provider.adapter.delete?.(machine.id, {
                idempotencyKey: `cleanup-${machine.id}`,
                signal: new AbortController().signal,
              });
        },
      };
    });
    return {
      passed: report.filter((item) => item.status === "passed").length,
      skipped: report.filter((item) => item.status === "skipped").length,
      total: report.length,
    };
  },
});
