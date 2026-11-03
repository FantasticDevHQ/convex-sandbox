import { expect, test } from "vitest";
import {
  createHostAccess,
  protectExecutionStore,
  protectSecretHandle,
  redactSandboxText,
  serializeSandboxError,
  withSandboxErrors,
} from "@fantastic.dev/convex-sandbox/server";
import {
  SandboxProviders,
  SandboxProviderError,
  registerProvider,
  type RegistryRecord,
  type ExecutionStore,
} from "@fantastic.dev/convex-sandbox";

const principal = { subject: "subject-a", scope: "scope-a" };
const row: RegistryRecord = {
  scope: "scope-a",
  key: "mine",
  reference: { provider: "fixture", providerId: "vm-a" },
  generation: 1,
  version: 1,
  observedState: "running",
  tombstone: false,
  refreshSequence: 0,
  observedSequence: 0,
  refresh: { status: "never" },
  updatedAt: 1,
};
function fixture() {
  const requests: unknown[] = [];
  const access = createHostAccess({
    authenticate: async () => principal,
    getSandbox: async (sandbox) => {
      requests.push(sandbox);
      return sandbox.key === "mine" && sandbox.scope === principal.scope
        ? row
        : null;
    },
    listSandboxes: async () => ({
      page: [row, { ...row, key: "denied" }],
      isDone: true,
      continueCursor: "",
    }),
    authorize: async (request) => request.sandbox.key === "mine",
    selectProvider: async () => "fixture",
    authorizePath: async ({ path }) =>
      path === "/workspace" || path.startsWith("/workspace/"),
  });
  return { access, requests };
}

test("trusted authentication chooses scope and resource mapping", async () => {
  const { access } = fixture();
  expect(await access.resolve({ key: "mine" }, "execute")).toEqual({
    sandbox: { scope: "scope-a", key: "mine" },
    reference: row.reference,
  });
  expect(await access.create({ key: "mine" })).toEqual({
    sandbox: { scope: "scope-a", key: "mine" },
    provider: "fixture",
  });
  expect(
    (await access.list({ limit: 10 })).page.map((item) => item.key),
  ).toEqual(["mine"]);
});

test.each([
  "scope",
  "owner",
  "provider",
  "providerId",
  "credentials",
  "authorizePath",
])("client configuration injection is rejected: %s", async (field) => {
  const { access } = fixture();
  await expect(
    access.resolve({ key: "mine", [field]: "injected" }, "get"),
  ).rejects.toMatchObject({ data: { code: "validation" } });
  await expect(
    access.create({ key: "mine", [field]: "injected" }),
  ).rejects.toMatchObject({ data: { code: "validation" } });
});

test.each(["get", "execute", "readFile", "getConnection", "delete"] as const)(
  "cross-scope %s authorization denies before foreign lookup",
  async (operation) => {
    const { access, requests } = fixture();
    await expect(
      access.authorize({
        sandbox: { scope: "scope-b", key: "mine" },
        reference: { provider: "fixture", providerId: "vm-b" },
        operation,
      }),
    ).rejects.toMatchObject({ data: { code: "authorization" } });
    expect(requests).toHaveLength(0);
  },
);

test("list rejects client scope and filters denied resources", async () => {
  const { access } = fixture();
  await expect(
    access.list({ limit: 10, scope: "scope-b" }),
  ).rejects.toMatchObject({ data: { code: "validation" } });
  expect(await access.list({ limit: 10 })).toMatchObject({
    partial: true,
    page: [{ key: "mine" }],
  });
});

test("forged provider references and creation providers cannot authorize SDK execution", async () => {
  const { access } = fixture();
  let calls = 0;
  const providers = new SandboxProviders({
    authorize: access.authorize,
    authorizeCreate: access.authorizeCreate,
  });
  providers.register(
    registerProvider({
      name: "injected",
      adapter: {
        describe: async (providerId) => {
          calls++;
          return { providerId, state: "running" };
        },
      },
    }),
  );
  await expect(
    providers.describe({
      sandbox: { scope: "scope-a", key: "mine" },
      reference: { provider: "injected", providerId: "foreign-vm" },
    }),
  ).rejects.toMatchObject({ data: { code: "authorization" } });
  await expect(
    access.authorizeCreate({
      sandbox: { scope: "scope-a", key: "mine" },
      provider: "injected",
    }),
  ).rejects.toMatchObject({ data: { code: "authorization" } });
  expect(calls).toBe(0);
});

test("path policy cannot bypass binding checks and canonical traversal rejection", async () => {
  const { access } = fixture();
  const input = {
    sandbox: { scope: "scope-a", key: "mine" },
    reference: row.reference,
    operation: "readFile" as const,
  };
  expect(
    await access.authorizePath({ ...input, path: "/workspace//file" }),
  ).toBe(true);
  expect(await access.authorizePath({ ...input, path: "/private/file" })).toBe(
    false,
  );
  await expect(
    access.authorizePath({ ...input, path: "/workspace/../private" }),
  ).rejects.toMatchObject({ data: { code: "validation" } });
  await expect(
    access.authorizePath({
      ...input,
      sandbox: { scope: "scope-b", key: "mine" },
      path: "/workspace/file",
    }),
  ).rejects.toMatchObject({ data: { code: "authorization" } });
});

test("authentication absence and private callback failures produce safe errors", async () => {
  const access = createHostAccess({
    authenticate: async () => null,
    getSandbox: async () => row,
    authorize: async () => true,
  });
  await expect(access.get({ key: "mine" })).rejects.toMatchObject({
    data: { code: "authentication" },
  });
  const broken = createHostAccess({
    authenticate: async () => {
      throw new Error("master-key-private");
    },
    getSandbox: async () => row,
    authorize: async () => true,
  });
  await expect(
    withSandboxErrors(() => broken.get({ key: "mine" })),
  ).rejects.not.toThrow("master-key-private");
  expect(
    serializeSandboxError(
      new SandboxProviderError({
        code: "rate_limit",
        outcome: "not_started",
        retryable: true,
        providerCode: "master-key-private",
      }),
    ),
  ).toEqual({
    version: 1,
    code: "rate_limit",
    outcome: "not_started",
    retryable: true,
  });
  expect(
    JSON.stringify(
      serializeSandboxError(
        new Error("https://signed.example.test/?token=master-key-private"),
      ),
    ),
  ).not.toContain("private");
});

function outputStore() {
  const unused = async (): Promise<never> => {
    throw new Error("Unused fixture method");
  };
  const published: Parameters<ExecutionStore["publish"]>[0][] = [],
    appended: Parameters<ExecutionStore["appendLogs"]>[0][] = [];
  const store: ExecutionStore = {
    getSandbox: unused,
    get: unused,
    reserve: unused,
    claim: unused,
    publish: async (args) => {
      published.push(args);
      return true;
    },
    requestCancel: unused,
    acknowledgeCancel: unused,
    claimLogs: unused,
    appendLogs: async (args) => {
      appended.push(args);
      return true;
    },
    logs: async () => ({
      entries: [
        {
          sequence: 1,
          stream: "stdout",
          text: "master-key-private https://signed.example.test/path?token=private",
        },
      ],
      nextCursor: null,
      isDone: true,
      truncated: false,
    }),
  };
  return { store, published, appended };
}
const handle = {
  sandbox: { scope: "scope-a", key: "mine" },
  operationId: "command",
  token: 1,
};

test("default retention strips output before component writes and when reading old caches", async () => {
  const f = outputStore(),
    store = protectExecutionStore(f.store);
  await store.publish({
    ...handle,
    result: {
      snapshot: {
        executionId: "exec",
        state: "completed",
        output: {
          stdout: "master-key-private",
          stderr: "https://signed.example.test",
          truncated: false,
        },
      },
    },
  });
  await store.appendLogs({
    ...handle,
    page: {
      entries: [{ stream: "stdout", text: "master-key-private" }],
      nextCursor: null,
      complete: true,
    },
  });
  expect(JSON.stringify([...f.published, ...f.appended])).not.toContain(
    "master-key-private",
  );
  expect(JSON.stringify(f.published)).not.toContain("https:");
  expect(
    (
      await store.logs({
        sandbox: handle.sandbox,
        operationId: "command",
        cursor: null,
        limit: 10,
      })
    ).entries,
  ).toHaveLength(0);
});

test("redacted retention requires server policy and removes known secrets and URLs", async () => {
  const f = outputStore();
  const store = protectExecutionStore(f.store, {
    retention: "redacted",
    secrets: ["master-key-private"],
    redact: (text) => text,
  });
  await store.appendLogs({
    ...handle,
    page: {
      entries: [
        {
          stream: "stdout",
          text: "progress master-key-private https://signed.example.test/path?token=private",
        },
      ],
      nextCursor: null,
      complete: true,
    },
  });
  expect(f.appended[0]?.page?.entries[0]?.text).toContain("progress");
  expect(JSON.stringify(f.appended)).not.toContain("master-key-private");
  expect(JSON.stringify(f.appended)).not.toContain("https:");
  expect(
    redactSandboxText("Bearer abc https://signed.example.test", ["abc"]),
  ).not.toContain("abc");
});

test("secret-bearing provider cursors fail closed instead of entering component state", async () => {
  const f = outputStore(),
    store = protectExecutionStore(f.store);
  await expect(
    store.appendLogs({
      ...handle,
      page: {
        entries: [],
        nextCursor: "https://signed.example.test?token=secret",
        complete: false,
      },
    }),
  ).rejects.toMatchObject({ data: { code: "validation" } });
  expect(f.appended).toHaveLength(0);
});

test("secret handles reject configured master keys, including URL-encoded forms", () => {
  const handle = {
    kind: "desktop" as const,
    url: "https://desktop.example.test/?token=master%2Bkey%2Fprivate",
    expiresAt: Date.now() + 1000,
    access: { kind: "public" as const },
  };
  expect(() => protectSecretHandle(handle, ["master+key/private"])).toThrow(
    "Invalid provider data",
  );
  const safe = {
    ...handle,
    url: "https://desktop.example.test/?token=short-lived",
  };
  const protectedHandle = protectSecretHandle(safe, ["master+key/private"]);
  safe.access = { kind: "public" };
  safe.url = "https://changed.example.test";
  expect(protectedHandle.url).toBe(
    "https://desktop.example.test/?token=short-lived",
  );
});

test("capability discovery remains authorized through the host callback", async () => {
  const { access } = fixture();
  await expect(
    access.authorize({
      sandbox: { scope: "scope-a", key: "mine" },
      reference: row.reference,
      operation: "capabilities",
    }),
  ).resolves.toBeUndefined();
});

test("known-secret redaction does not recursively expand its own replacement markers", () => {
  expect(redactSandboxText("secret", ["e", "e", "e", "e"])).toBe(
    "s[redacted]cr[redacted]t",
  );
});

test("known-secret matching treats credential punctuation as literal text", () => {
  expect(redactSandboxText("value a.b+c[d](e)$ end", ["a.b+c[d](e)$"])).toBe(
    "value [redacted] end",
  );
});
