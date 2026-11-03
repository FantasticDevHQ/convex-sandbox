import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { action, query } from "./_generated/server.js";
import { components } from "./_generated/api.js";
import {
  registryRecordValidator,
  operationRecordValidator,
  registryPageValidator,
  operationPageValidator,
  executionRecordValidator,
  cachedLogPageValidator,
  fileTextReadValidator,
  fileWriteValidator,
  fileDeleteValidator,
  fileListValidator,
  capabilitiesValidator,
  connectionKindValidator,
} from "@fantastic.dev/convex-sandbox";
import {
  protectSecretHandle,
  withSandboxErrors,
} from "@fantastic.dev/convex-sandbox/server";
import { createSimulatedProvider } from "@fantastic.dev/convex-sandbox/testing";
import {
  profiles,
  profileValidator,
  scenarioValidator,
  seedResultValidator,
  infoValidator,
  fileIndexValidator,
  fixtureConnectionValidator,
  fixtureTransferValidator,
  localFixture,
  providerFor,
  operationId,
  deny,
} from "./demo/contracts.js";
import { control, profileFiles } from "./demo/store.js";
import {
  accessFor,
  withLease,
  services,
  commandFor,
  seedAll,
} from "./demo/service.js";

export const info = query({
  args: {},
  returns: infoValidator,
  handler: async (ctx) => {
    localFixture();
    const row = await control(ctx);
    return {
      mode: "simulation" as const,
      localFixture: true as const,
      initialized: row?.initialized ?? false,
      epoch: row?.epoch ?? 0,
      busy: (row?.leaseUntil ?? 0) > Date.now(),
      leaseUntil: row?.leaseUntil ?? 0,
      profiles: profiles.map((profile) => ({
        profile,
        provider: providerFor(profile),
        capabilities: createSimulatedProvider({
          profile,
          name: providerFor(profile),
        }).provider.capabilities ?? { version: 1 as const, supported: [] },
      })),
    };
  },
});
export const capabilities = query({
  args: { profile: profileValidator },
  returns: capabilitiesValidator,
  handler: (_, { profile }) => {
    localFixture();
    return (
      createSimulatedProvider({ profile, name: providerFor(profile) }).provider
        .capabilities ?? { version: 1 as const, supported: [] }
    );
  },
});
export const list = query({
  args: {},
  returns: v.object({ ...registryPageValidator.fields, partial: v.boolean() }),
  handler: async (ctx) =>
    withSandboxErrors(async () => {
      localFixture();
      const row = await control(ctx);
      if (!row?.initialized)
        return { page: [], isDone: true, continueCursor: "", partial: false };
      return accessFor(ctx, row.epoch).list({ limit: 3 });
    }),
});
export const get = query({
  args: { profile: profileValidator },
  returns: v.union(v.null(), registryRecordValidator),
  handler: async (ctx, { profile }) =>
    withSandboxErrors(async () => {
      localFixture();
      const row = await control(ctx);
      if (!row?.initialized) return null;
      return accessFor(ctx, row.epoch).get({ key: profile });
    }),
});
export const history = query({
  args: { profile: profileValidator, paginationOpts: paginationOptsValidator },
  returns: operationPageValidator,
  handler: async (ctx, { profile, paginationOpts }) =>
    withSandboxErrors(async () => {
      localFixture();
      const row = await control(ctx);
      if (!row?.initialized)
        return { page: [], isDone: true, continueCursor: "" };
      const { sandbox } = await accessFor(ctx, row.epoch).resolve(
        { key: profile },
        "get",
      );
      return ctx.runQuery(components.sandbox.operations.list, {
        sandbox,
        paginationOpts,
      });
    }),
});
export const execution = query({
  args: { profile: profileValidator, operationId: v.string() },
  returns: v.union(v.null(), executionRecordValidator),
  handler: async (ctx, args) =>
    withSandboxErrors(async () => {
      localFixture();
      operationId(args.operationId);
      const row = await control(ctx);
      if (!row?.initialized) return null;
      const { sandbox } = await accessFor(ctx, row.epoch).resolve(
        { key: args.profile },
        "executionGet",
      );
      return ctx.runQuery(components.sandbox.execution.get, {
        sandbox,
        operationId: args.operationId,
      });
    }),
});
export const logs = query({
  args: {
    profile: profileValidator,
    operationId: v.string(),
    cursor: v.union(v.number(), v.null()),
  },
  returns: cachedLogPageValidator,
  handler: async (ctx, args) =>
    withSandboxErrors(async () => {
      localFixture();
      operationId(args.operationId);
      const row = await control(ctx);
      if (!row?.initialized)
        return {
          entries: [],
          nextCursor: null,
          isDone: true,
          truncated: false,
        };
      const { sandbox } = await accessFor(ctx, row.epoch).resolve(
        { key: args.profile },
        "executionGet",
      );
      return ctx.runQuery(components.sandbox.execution.logs, {
        sandbox,
        operationId: args.operationId,
        cursor: args.cursor,
        limit: 2,
      });
    }),
});
export const files = query({
  args: { profile: profileValidator },
  returns: fileIndexValidator,
  handler: async (ctx, { profile }) =>
    withSandboxErrors(async () => {
      localFixture();
      const row = await control(ctx);
      if (!row?.initialized) return [];
      await accessFor(ctx, row.epoch).resolve({ key: profile }, "get");
      return profileFiles(ctx, profile, row.epoch);
    }),
});

export const seed = action({
  args: {},
  returns: seedResultValidator,
  handler: (ctx) =>
    withLease(ctx, false, false, (lease) => seedAll(ctx, lease)),
});
export const reset = action({
  args: {},
  returns: seedResultValidator,
  handler: (ctx) => withLease(ctx, true, false, (lease) => seedAll(ctx, lease)),
});
export const lifecycle = action({
  args: {
    profile: profileValidator,
    action: v.union(v.literal("start"), v.literal("stop"), v.literal("delete")),
    operationId: v.string(),
  },
  returns: v.union(v.null(), operationRecordValidator),
  handler: (ctx, args) =>
    withLease(ctx, false, true, async (lease) => {
      operationId(args.operationId);
      const client = await services(ctx, lease, args.profile);
      return client.lifecycle.run({
        sandbox: client.sandbox,
        action: args.action,
        operationId: args.operationId,
      });
    }),
});
export const execute = action({
  args: {
    profile: profileValidator,
    operationId: v.string(),
    scenario: scenarioValidator,
  },
  returns: executionRecordValidator,
  handler: (ctx, args) =>
    withLease(ctx, false, true, async (lease) => {
      operationId(args.operationId);
      const client = await services(ctx, lease, args.profile);
      if (args.scenario === "lost-reply")
        client.simulated.faults.failNext("execution.start", "after");
      if (args.scenario === "rejected")
        client.simulated.faults.failNext("execution.start", "before");
      const handle = { sandbox: client.sandbox, operationId: args.operationId };
      const result = await client.execution.start({
        ...handle,
        input: commandFor(args.scenario),
      });
      if (result.executionId && result.state !== "unknown")
        await client.execution.syncLogs(handle);
      return (await client.execution.get(handle)) ?? result;
    }),
});
export const status = action({
  args: { profile: profileValidator, operationId: v.string() },
  returns: v.union(v.null(), executionRecordValidator),
  handler: (ctx, args) =>
    withLease(ctx, false, true, async (lease) => {
      operationId(args.operationId);
      const client = await services(ctx, lease, args.profile),
        handle = { sandbox: client.sandbox, operationId: args.operationId },
        result = await client.execution.status(handle);
      if (result?.executionId && result.state !== "unknown")
        await client.execution.syncLogs(handle);
      return client.execution.get(handle);
    }),
});
export const cancel = action({
  args: { profile: profileValidator, operationId: v.string() },
  returns: v.union(v.null(), executionRecordValidator),
  handler: (ctx, args) =>
    withLease(ctx, false, true, async (lease) => {
      operationId(args.operationId);
      const client = await services(ctx, lease, args.profile);
      return client.execution.cancel({
        sandbox: client.sandbox,
        operationId: args.operationId,
      });
    }),
});
export const listFiles = action({
  args: {
    profile: profileValidator,
    path: v.string(),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  returns: fileListValidator,
  handler: (ctx, args) =>
    withLease(ctx, false, true, async (lease) => {
      const client = await services(ctx, lease, args.profile);
      return client.files.list({
        sandbox: client.sandbox,
        path: args.path,
        cursor: args.cursor,
        limit: 20,
      });
    }),
});
export const readFile = action({
  args: {
    profile: profileValidator,
    path: v.string(),
    offset: v.optional(v.number()),
  },
  returns: fileTextReadValidator,
  handler: (ctx, args) =>
    withLease(ctx, false, true, async (lease) => {
      const client = await services(ctx, lease, args.profile);
      return client.files.readText({
        sandbox: client.sandbox,
        path: args.path,
        offset: args.offset,
        maxBytes: 4096,
      });
    }),
});
export const writeFile = action({
  args: {
    profile: profileValidator,
    path: v.string(),
    text: v.string(),
    operationId: v.string(),
  },
  returns: fileWriteValidator,
  handler: (ctx, args) =>
    withLease(ctx, false, true, async (lease) => {
      operationId(args.operationId);
      if (
        args.text.length > 4096 ||
        new TextEncoder().encode(args.text).length > 4096
      )
        deny("validation");
      const client = await services(ctx, lease, args.profile);
      return client.files.writeText({
        sandbox: client.sandbox,
        path: args.path,
        text: args.text,
        operationId: args.operationId,
      });
    }),
});
export const deleteFile = action({
  args: {
    profile: profileValidator,
    path: v.string(),
    operationId: v.string(),
  },
  returns: fileDeleteValidator,
  handler: (ctx, args) =>
    withLease(ctx, false, true, async (lease) => {
      operationId(args.operationId);
      const client = await services(ctx, lease, args.profile);
      return client.files.delete({
        sandbox: client.sandbox,
        path: args.path,
        operationId: args.operationId,
      });
    }),
});
export const connection = action({
  args: { profile: profileValidator, kind: connectionKindValidator },
  returns: fixtureConnectionValidator,
  handler: (ctx, args) =>
    withLease(ctx, false, true, async (lease) => {
      const client = await services(ctx, lease, args.profile);
      return {
        mode: "simulation" as const,
        functional: false as const,
        handle: protectSecretHandle(
          await client.images.connection({
            sandbox: client.sandbox,
            kind: args.kind,
            expiresInMs: 30000,
          }),
          [],
        ),
      };
    }),
});
export const transfer = action({
  args: {
    profile: profileValidator,
    path: v.string(),
    direction: v.union(v.literal("download"), v.literal("upload")),
    operationId: v.string(),
  },
  returns: fixtureTransferValidator,
  handler: (ctx, args) =>
    withLease(ctx, false, true, async (lease) => {
      operationId(args.operationId);
      const client = await services(ctx, lease, args.profile);
      return {
        mode: "simulation" as const,
        functional: false as const,
        handle: protectSecretHandle(
          await client.files.transfer({
            sandbox: client.sandbox,
            path: args.path,
            direction: args.direction,
            operationId: args.operationId,
            maxBytes: 4096,
            expiresInMs: 30000,
          }),
          [],
        ),
      };
    }),
});

export const snapshot = action({
  args: { profile: profileValidator, operationId: v.string() },
  returns: operationRecordValidator,
  handler: (ctx, args) =>
    withLease(ctx, false, true, async (lease) => {
      operationId(args.operationId);
      const client = await services(ctx, lease, args.profile);
      return client.images.run({
        sandbox: client.sandbox,
        operationId: args.operationId,
        kind: "snapshotDisk",
      });
    }),
});
export const snapshotStatus = action({
  args: { profile: profileValidator, operationId: v.string() },
  returns: v.union(v.null(), operationRecordValidator),
  handler: (ctx, args) =>
    withLease(ctx, false, true, async (lease) => {
      operationId(args.operationId);
      const client = await services(ctx, lease, args.profile);
      return client.images.status({
        sandbox: client.sandbox,
        operationId: args.operationId,
      });
    }),
});
