import { expect, test } from "vitest";
import { v } from "convex/values";
import {
  registerProvider,
  SandboxProviders,
} from "@fantastic.dev/convex-sandbox";

const sandbox = { scope: "opaque/workspace:42", key: "opaque-machine" };
const reference = { provider: "fixture", providerId: "machine-1" };

test("public registration dispatches arbitrary providers and projects SDK fields", async () => {
  const calls: string[] = [];
  const providers = new SandboxProviders({
    authorize: async ({ sandbox, reference }) => {
      calls.push(`authorize:${sandbox.scope}:${reference.providerId}`);
    },
  });
  providers.register(
    registerProvider({
      name: "fixture",
      adapter: {
        describe: async (id) => {
          calls.push(`describe:${id}`);
          return {
            providerId: id,
            state: "running",
            resources: {
              cpuCount: 2,
              memoryMiB: 4096,
              diskMiB: 10240,
              token: "private",
            },
            token: "private",
          };
        },
      },
    }),
  );
  expect(await providers.describe({ sandbox, reference })).toEqual({
    sandbox,
    reference,
    state: "running",
    resources: { cpuCount: 2, memoryMiB: 4096, diskMiB: 10240 },
  });
  expect(calls).toEqual([
    `authorize:${sandbox.scope}:machine-1`,
    "describe:machine-1",
  ]);
  providers.register(
    registerProvider({
      name: "another",
      adapter: {
        describe: async (id) => ({ providerId: id, state: "unknown" }),
      },
    }),
  );
  expect(
    (
      await providers.describe({
        sandbox,
        reference: { provider: "another", providerId: "replacement" },
      })
    ).reference.providerId,
  ).toBe("replacement");
});

test("authorization failure prevents provider lookup and execution", async () => {
  let calls = 0;
  const providers = new SandboxProviders({
    authorize: async () => {
      throw new Error("Denied");
    },
  });
  providers.register(
    registerProvider({
      name: "fixture",
      adapter: {
        describe: async (id) => {
          calls++;
          return { providerId: id, state: "running" };
        },
      },
    }),
  );
  for (const provider of ["fixture", "missing"]) {
    await expect(
      providers.describe({ sandbox, reference: { ...reference, provider } }),
    ).rejects.toThrow("Denied");
  }
  expect(calls).toBe(0);
});

test("duplicate registration and foreign extension namespaces fail", () => {
  const adapter = {
    describe: async (providerId: string) => ({
      providerId,
      state: "stopped" as const,
    }),
  };
  const providers = new SandboxProviders({ authorize: async () => {} });
  providers.register(registerProvider({ name: "fixture", adapter }));
  expect(() =>
    providers.register(registerProvider({ name: "fixture", adapter })),
  ).toThrow("already registered");
  expect(() =>
    registerProvider({
      name: "fixture",
      adapter,
      extensions: {
        // @ts-expect-error Extensions must belong to the registering provider.
        "other.snapshot": { args: v.string(), returns: v.string() },
      },
    }),
  ).toThrow("namespace");
  expect(() =>
    registerProvider({
      name: "fixture",
      adapter,
      extensions: { "fixture.": { args: v.string(), returns: v.string() } },
    }),
  ).toThrow("namespace");
});

test.each([
  { providerId: "foreign", state: "running" },
  { providerId: "machine-1", state: "invented" },
  { providerId: "machine-1", state: "running", resources: { cpuCount: -1 } },
  {
    providerId: "machine-1",
    state: "running",
    resources: { memoryMiB: Infinity },
  },
  {
    providerId: "machine-1",
    state: "running",
    resources: { memoryMiB: "4096" },
  },
])("invalid provider data is rejected: %j", async (result) => {
  const providers = new SandboxProviders({ authorize: async () => {} });
  providers.register(
    registerProvider({
      name: "fixture",
      adapter: {
        // Deliberately emulate an SDK bypassing the compile-time contract.
        // @ts-expect-error The runtime boundary must still reject malformed results.
        describe: async () => result,
      },
    }),
  );
  await expect(providers.describe({ sandbox, reference })).rejects.toThrow(
    "Invalid provider description",
  );
});

test("callers cannot replace authorized identity while authorization is pending", async () => {
  let release: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  const input = { sandbox: { ...sandbox }, reference: { ...reference } };
  const calls: string[] = [];
  const providers = new SandboxProviders({ authorize: async () => ready });
  providers.register(
    registerProvider({
      name: "fixture",
      adapter: {
        describe: async (id) => {
          calls.push(id);
          return { providerId: id, state: "running" };
        },
      },
    }),
  );
  const pending = providers.describe(input);
  input.sandbox.scope = "substituted";
  input.reference.providerId = "substituted";
  release();
  expect(await pending).toEqual({ sandbox, reference, state: "running" });
  expect(calls).toEqual(["machine-1"]);
});

test("missing providers and adapter errors fail without retries", async () => {
  const providers = new SandboxProviders({ authorize: async () => {} });
  await expect(providers.describe({ sandbox, reference })).rejects.toThrow(
    "Unknown provider",
  );
  let calls = 0;
  providers.register(
    registerProvider({
      name: "fixture",
      adapter: {
        describe: async () => {
          calls++;
          throw new Error("Adapter failed");
        },
      },
    }),
  );
  await expect(providers.describe({ sandbox, reference })).rejects.toThrow(
    "Adapter failed",
  );
  expect(calls).toBe(1);
});
