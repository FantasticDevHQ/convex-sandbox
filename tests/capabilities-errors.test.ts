import { expect, test } from "vitest";
import { v } from "convex/values";
import {
  SandboxProviders,
  registerProvider,
  defineCapabilities,
  requireCapability,
  SandboxProviderError,
  normalizeProviderError,
  retryAdvice,
  type Capability,
} from "@fantastic.dev/convex-sandbox";

const request = {
  sandbox: { scope: "trusted", key: "key" },
  reference: { provider: "fixture", providerId: "id" },
};

test.each([true, false])(
  "describe is gated before SDK effects, supported=%s",
  async (supported) => {
    let calls = 0;
    const providers = new SandboxProviders({ authorize: async () => {} });
    providers.register(
      registerProvider({
        name: "fixture",
        capabilities: { version: 1, supported: supported ? ["describe"] : [] },
        adapter: {
          describe: async (providerId) => {
            calls++;
            return { providerId, state: "running" };
          },
        },
      }),
    );
    if (supported)
      expect((await providers.describe(request)).state).toBe("running");
    else
      await expect(providers.describe(request)).rejects.toMatchObject({
        data: {
          code: "unsupported",
          capability: "describe",
          outcome: "not_started",
          retryable: false,
        },
      });
    expect(calls).toBe(supported ? 1 : 0);
  },
);

test("discovery authorizes, snapshots configuration and omits SDK objects", async () => {
  const supported: Capability[] = ["describe", "snapshotDisk"];
  const auth: string[] = [];
  const providers = new SandboxProviders({
    authorize: async ({ operation }) => {
      auth.push(operation);
    },
  });
  providers.register(
    registerProvider({
      name: "fixture",
      capabilities: { version: 1, supported, limits: { maxLifetimeMs: 60000 } },
      adapter: {
        describe: async (providerId) => ({ providerId, state: "running" }),
      },
    }),
  );
  supported.push("suspendMemory");
  expect(await providers.capabilities(request)).toEqual({
    version: 1,
    supported: ["describe", "snapshotDisk"],
    limits: { maxLifetimeMs: 60000 },
  });
  expect(auth).toEqual(["capabilities"]);
  const denied = new SandboxProviders({
    authorize: async () => {
      throw new Error("Denied");
    },
  });
  await expect(denied.capabilities(request)).rejects.toThrow("Denied");
});

test.each([
  { version: 2, supported: ["describe"] },
  { version: 1, supported: ["invented"] },
  { version: 1, supported: ["describe"], limits: { maxLifetimeMs: Infinity } },
  { version: 1, supported: [], limits: { unknown: 1 } },
  { version: 1, supported: [], token: "must-not-be-accepted" },
])("invalid descriptors fail registration: %j", (input) => {
  // @ts-expect-error Deliberately check JavaScript callers and unsupported versions.
  expect(() => defineCapabilities(input)).toThrow("Invalid capabilities");
});

test.each([
  {
    supported: ["snapshotDisk"],
    allowed: "snapshotDisk",
    denied: "suspendMemory",
  },
  {
    supported: ["suspendMemory", "resumeMemory"],
    allowed: "suspendMemory",
    denied: "snapshotDisk",
  },
  { supported: ["delete"], allowed: "delete", denied: "snapshotDisk" },
] as const)(
  "contrasting provider capabilities: %j",
  ({ supported, allowed, denied }) => {
    const capabilities = defineCapabilities({
      version: 1,
      supported: [...supported],
    });
    expect(() => requireCapability(capabilities, allowed)).not.toThrow();
    expect(() => requireCapability(capabilities, denied)).toThrow(
      SandboxProviderError,
    );
  },
);

test.each([
  "validation",
  "authentication",
  "authorization",
  "quota",
  "rate_limit",
  "capacity",
  "timeout",
  "stale_resource",
  "unknown_outcome",
] as const)("structured errors retain classification: %s", (code) => {
  const error = new SandboxProviderError({
    code,
    outcome: "unknown",
    retryable: true,
    providerCode: "SYNTHETIC_CODE",
    retryAfterMs: 1000,
  });
  expect(normalizeProviderError(error).data).toMatchObject({
    version: 1,
    code,
    providerCode: "SYNTHETIC_CODE",
    retryAfterMs: 1000,
  });
});

test.each([
  ["unknown", "write", true, "reconcile"],
  ["unknown", "write", false, "reconcile"],
  ["not_started", "write", true, "retry"],
  ["failed", "write", true, "stop"],
  ["unknown", "read", true, "retry"],
  ["not_started", "read", false, "stop"],
] as const)(
  "retry advice %s/%s/%s -> %s",
  (outcome, effect, retryable, action) => {
    const error = new SandboxProviderError({
      code: "timeout",
      outcome,
      retryable,
    });
    expect(retryAdvice(error.data, effect)).toBe(action);
  },
);

test("unknown SDK failures expose no raw messages, headers or credentials", async () => {
  let calls = 0;
  const providers = new SandboxProviders({ authorize: async () => {} });
  providers.register(
    registerProvider({
      name: "fixture",
      adapter: {
        describe: async () => {
          calls++;
          throw new Error("private-token-and-url");
        },
      },
    }),
  );
  const error = await providers
    .describe(request)
    .catch((error: unknown) => error);
  expect(error).toBeInstanceOf(SandboxProviderError);
  expect(JSON.stringify(error)).not.toContain("private-token");
  expect(String(error)).not.toContain("private-token");
  expect(calls).toBe(1);
});

test("extension protocol versions and validators are checked without executing extensions", () => {
  const adapter = {
    describe: async (providerId: string) => ({
      providerId,
      state: "running" as const,
    }),
  };
  expect(() =>
    registerProvider({
      name: "fixture",
      adapter,
      extensions: {
        "fixture.snapshot": {
          version: 1,
          args: v.string(),
          returns: v.string(),
        },
      },
    }),
  ).not.toThrow();
  expect(() =>
    registerProvider({
      name: "fixture",
      adapter,
      extensions: {
        // @ts-expect-error Unknown extension protocol versions must fail at runtime too.
        "fixture.snapshot": {
          version: 2,
          args: v.string(),
          returns: v.string(),
        },
      },
    }),
  ).toThrow("Invalid extension contract");
  expect(() =>
    registerProvider({
      name: "fixture",
      adapter,
      extensions: {
        "fixture.snapshot": {
          args: v.optional(v.string()),
          returns: v.string(),
        },
      },
    }),
  ).toThrow("Invalid extension contract");
});

test("error normalization drops attached SDK metadata", () => {
  const error = Object.assign(
    new SandboxProviderError({
      code: "rate_limit",
      outcome: "not_started",
      retryable: true,
      providerCode: "429",
    }),
    { headers: { Authorization: "private-token" } },
  );
  expect(JSON.stringify(normalizeProviderError(error))).not.toContain(
    "private-token",
  );
});

test.each([
  { code: "unknown_outcome", outcome: "not_started", retryable: true },
  {
    code: "timeout",
    outcome: "unknown",
    retryable: true,
    capability: "invented",
  },
  { code: "timeout", outcome: "unknown", retryable: true, retryAfterMs: -1 },
])("contradictory or malformed error data is rejected: %j", (input) => {
  // @ts-expect-error JavaScript adapters must also satisfy the wire contract.
  expect(() => new SandboxProviderError(input)).toThrow(
    "Invalid provider error",
  );
});

test("retry advice rejects unknown effect and protocol versions", () => {
  const data = new SandboxProviderError({
    code: "timeout",
    outcome: "unknown",
    retryable: true,
  }).data;
  // @ts-expect-error Unknown effects cannot default to read-only safety.
  expect(() => retryAdvice(data, "execute")).toThrow("Invalid retry effect");
  // @ts-expect-error Unknown protocol versions cannot change retry interpretation.
  expect(() => retryAdvice({ ...data, version: 2 }, "write")).toThrow(
    "Invalid provider error version",
  );
});

test("native feature namespaces and extension fields cannot escape their protocol", () => {
  const adapter = {
    describe: async (providerId: string) => ({
      providerId,
      state: "running" as const,
    }),
  };
  expect(() =>
    registerProvider({
      name: "fixture",
      adapter,
      capabilities: {
        version: 1,
        supported: [],
        nativeFeatures: ["other.git"],
      },
    }),
  ).toThrow("Invalid native feature namespace");
  expect(() =>
    registerProvider({
      name: "fixture",
      adapter,
      extensions: {
        "fixture.snapshot": {
          args: v.string(),
          returns: v.string(),
          unknown: true,
        },
      },
    }),
  ).toThrow("Invalid extension contract");
});
