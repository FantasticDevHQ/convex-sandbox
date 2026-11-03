import { convexTest } from "convex-test";
import { defineSchema } from "convex/server";
import { expect, test } from "vitest";
import {
  adapterConformance,
  createTestStores,
  createSimulatedProvider,
  register,
  runAdapterConformance,
  type SimulatedProfile,
} from "@fantastic.dev/convex-sandbox/testing";

function factory(
  profile: SimulatedProfile = "persistent",
  idempotency: "native" | "none" = "native",
) {
  return () => {
    const t = convexTest(defineSchema({}), {
      "./_generated/server.js": () =>
        import("../example/convex/_generated/server.js"),
    });
    const component = register(t),
      simulated = createSimulatedProvider({ profile, idempotency });
    return {
      provider: simulated.provider,
      stores: createTestStores(
        t,
        component,
        async ({ path }) =>
          path === "/workspace" || path.startsWith("/workspace/"),
      ),
      sandbox: { scope: "conformance-fixture", key: "machine" },
      commands: {
        complete: {
          kind: "argv" as const,
          executable: "fixture",
          args: ["echo", "conformance"],
        },
        running: {
          kind: "argv" as const,
          executable: "fixture",
          args: ["progress", "4", "conformance"],
        },
        largeOutput: {
          kind: "argv" as const,
          executable: "fixture",
          args: ["generate", "100000"],
        },
      },
      expectedOutput: "conformance\n",
      cleanup: async () => {},
    };
  };
}
for (const profile of ["ephemeral", "persistent", "memory"] as const) {
  for (const item of adapterConformance(factory(profile)))
    test(`${profile}: ${item.name}`, async ({ skip }) => {
      const result = await item.run();
      if (result.status === "skipped") skip();
    });
}

test("the same public suite supports non-native idempotency without core edits", async () => {
  const report = await runAdapterConformance(factory("persistent", "none"));
  expect(
    report.every(
      (item) => item.status === "passed" || item.status === "skipped",
    ),
  ).toBe(true);
  expect(
    report.filter((item) => item.status === "passed").length,
  ).toBeGreaterThan(8);
});

test("malformed advertised adapters fail clearly and always run cleanup", async () => {
  let cleaned = 0;
  const suite = adapterConformance(() => {
    const fixture = factory()();
    return {
      ...fixture,
      provider: {
        ...fixture.provider,
        adapter: { ...fixture.provider.adapter, files: undefined },
      },
      cleanup: async () => {
        cleaned++;
      },
    };
  });
  const declaration = suite.find(
    (item) => item.name === "capability declarations",
  );
  if (!declaration) throw new Error("Missing conformance case");
  await expect(declaration.run()).rejects.toThrow("capability declarations");
  expect(cleaned).toBe(1);
});

test("raw SDK errors are not included in conformance failure reports", async () => {
  const suite = adapterConformance(() => {
    const fixture = factory()();
    return {
      ...fixture,
      provider: {
        ...fixture.provider,
        adapter: {
          ...fixture.provider.adapter,
          create: async () => {
            throw new Error("private-master-key");
          },
        },
      },
    };
  });
  const lifecycle = suite.find(
    (item) => item.name === "lifecycle and persistence",
  );
  if (!lifecycle) throw new Error("Missing conformance case");
  await expect(lifecycle.run()).rejects.not.toThrow("private-master-key");
});

test("restore-only adapters use an explicitly seeded native image fixture", async () => {
  let restores = 0;
  const suite = adapterConformance(async () => {
    const fixture = factory()(),
      sdk = fixture.provider.adapter;
    const context = {
      idempotencyKey: "seed",
      signal: new AbortController().signal,
    };
    const machine = await sdk.create?.({}, context);
    if (
      !machine ||
      !sdk.images?.snapshotDisk ||
      !sdk.images.status ||
      !sdk.images.restore
    )
      throw new Error("Missing seed fixture");
    const started = await sdk.images.snapshotDisk(machine.providerId, context);
    if (started.state !== "pending") throw new Error("Missing seed job");
    const ready = await sdk.images.status(
      machine.providerId,
      started.operationId,
      context,
    );
    if (ready.state !== "ready" || !("image" in ready.result))
      throw new Error("Missing seed image");
    const restore = sdk.images.restore;
    return {
      ...fixture,
      restoreImage: ready.result.image,
      provider: {
        ...fixture.provider,
        capabilities: {
          version: 1 as const,
          supported: ["create", "describe", "restore"] as (
            "create" | "describe" | "restore"
          )[],
        },
        adapter: {
          ...sdk,
          images: {
            ...sdk.images,
            restore: async (...args: Parameters<typeof restore>) => {
              restores++;
              return restore(...args);
            },
          },
        },
      },
    };
  });
  const entry = suite.find(
    (item) => item.name === "native images and connections",
  );
  if (!entry) throw new Error("Missing conformance case");
  await entry.run();
  expect(restores).toBe(1);
});

test("binary conformance rejects a silently empty read after a nonempty write", async () => {
  const suite = adapterConformance(() => {
    const fixture = factory()(),
      sdk = fixture.provider.adapter,
      read = sdk.files?.read;
    if (!read) throw new Error("Missing fixture read");
    return {
      ...fixture,
      provider: {
        ...fixture.provider,
        adapter: {
          ...sdk,
          files: {
            ...sdk.files,
            read: async (...args: Parameters<typeof read>) =>
              args[1].endsWith("/binary")
                ? { data: new ArrayBuffer(0), offset: 0, complete: true }
                : read(...args),
          },
        },
      },
    };
  });
  const entry = suite.find((item) => item.name === "files and path guards");
  if (!entry) throw new Error("Missing conformance case");
  await expect(entry.run()).rejects.toThrow(
    "binary round trip changed content",
  );
});

test("a separate describe-only adapter consumes the suite without core changes", async () => {
  let cleaned = 0;
  class ExternalAdapter {
    async describe(providerId: string) {
      return { providerId, state: "running" as const };
    }
  }
  const report = await runAdapterConformance(() => {
    const t = convexTest(defineSchema({}), {
      "./_generated/server.js": () =>
        import("../example/convex/_generated/server.js"),
    });
    const c = register(t),
      sandbox = { scope: "external-fixture", key: "machine" };
    return {
      provider: {
        name: "external",
        adapter: new ExternalAdapter(),
        capabilities: {
          version: 1 as const,
          supported: ["describe"] as "describe"[],
        },
      },
      sandbox,
      stores: createTestStores(t, c, async () => false),
      commands: {
        complete: { kind: "shell" as const, command: "unused" },
        running: { kind: "shell" as const, command: "unused" },
        largeOutput: { kind: "shell" as const, command: "unused" },
      },
      expectedOutput: "",
      prepare: async () => {
        await t.mutation(c.registry.ensure, {
          sandbox,
          reference: {
            provider: "external",
            providerId: "external-fixture-vm",
          },
        });
      },
      cleanup: async () => {
        cleaned++;
      },
    };
  });
  expect(report.some((item) => item.status === "skipped")).toBe(true);
  expect(report.some((item) => item.status === "passed")).toBe(true);
  expect(cleaned).toBe(report.length);
});
