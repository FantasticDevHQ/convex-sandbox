import {
  SandboxProviders,
  type ProviderRegistration,
} from "../client/providers.js";
import { SandboxProviderError } from "../client/errors.js";
import { defineCapabilities, type Capability } from "../capabilities.js";
import type { CommandInput } from "../execution.js";
import type { ImageReference } from "../images.js";
import type { SandboxKey } from "../contracts.js";
import type { OperationRecord } from "../state.js";
import { filePath } from "../client/fileProtocol.js";
import { instrumentAdapter } from "./faults.js";
import type { ConformanceStores } from "./stores.js";

export interface ConformanceFixture {
  provider: ProviderRegistration;
  stores: ConformanceStores;
  sandbox: SandboxKey;
  commands: {
    complete: CommandInput;
    running: CommandInput;
    largeOutput: CommandInput;
  };
  expectedOutput: string;
  fileRoot?: string;
  templateId?: string;
  restoreImage?: ImageReference;
  pollBudget?: number;
  beforePoll?(): Promise<void>;
  prepare?(): Promise<void>;
  /** Must own and dispose every resource created by this isolated fixture, even lost replies. */
  cleanup(): Promise<void>;
}
export type ConformanceFactory = () =>
  ConformanceFixture | Promise<ConformanceFixture>;
export interface ConformanceResult {
  name: string;
  status: "passed" | "skipped";
  reason?: string;
}
export interface ConformanceCase {
  name: string;
  run(): Promise<ConformanceResult>;
}
export class ConformanceFailure extends Error {
  constructor(name: string, reason: string) {
    super(`Adapter conformance failed: ${name}: ${reason}`);
    this.name = "ConformanceFailure";
  }
}
class Skip extends Error {}
class ContractAssertion extends Error {}
function clients(provider: ProviderRegistration, stores: ConformanceStores) {
  const registry = new SandboxProviders({
    authorize: async () => {},
    authorizeCreate: async () => {},
  });
  registry.register(provider);
  return {
    lifecycle: registry.lifecycle(stores.lifecycle),
    execution: registry.execution(stores.execution),
    files: registry.files(stores.files),
    images: registry.images(stores.images),
  };
}
function context(fixture: ConformanceFixture) {
  const faulted = instrumentAdapter(fixture.provider),
    api = clients(faulted.provider, fixture.stores);
  const capabilities = defineCapabilities(
    fixture.provider.capabilities ?? { version: 1, supported: ["describe"] },
  );
  const polls = fixture.pollBudget ?? 8;
  if (!Number.isSafeInteger(polls) || polls < 1 || polls > 32)
    throw new Error("Invalid conformance poll budget");
  const check = (condition: unknown, message: string) => {
    if (!condition) throw new ContractAssertion(message);
  };
  const need = (...features: Capability[]) => {
    if (features.some((feature) => !capabilities.supported.includes(feature)))
      throw new Skip(`requires ${features.join(", ")}`);
  };
  const file = (name: string) =>
    `${filePath(fixture.fileRoot ?? "/workspace").replace(/\/$/, "")}/${name}`;
  async function ready() {
    await fixture.prepare?.();
    let row = await fixture.stores.lifecycle.get(fixture.sandbox);
    if (!row) {
      need("create");
      await api.lifecycle.create({
        sandbox: fixture.sandbox,
        provider: fixture.provider.name,
        operationId: "provision",
      });
    }
    for (let attempt = 0; attempt < polls; attempt++) {
      row = await api.lifecycle.get(fixture.sandbox);
      if (row?.observedState === "running") return row;
      if (!row) throw new Error("provisioning did not produce a binding");
      await fixture.beforePoll?.();
      await api.lifecycle.refresh(fixture.sandbox);
    }
    throw new Error("fixture did not become running within poll budget");
  }
  async function lifecycle(action: "start" | "stop" | "delete") {
    let op = await api.lifecycle.run({
      sandbox: fixture.sandbox,
      operationId: action,
      action,
    });
    for (
      let attempt = 0;
      op?.status !== "succeeded" && attempt < polls;
      attempt++
    ) {
      await fixture.beforePoll?.();
      op = await api.lifecycle.reconcile({
        sandbox: fixture.sandbox,
        operationId: action,
      });
    }
    check(op?.status === "succeeded", "lifecycle did not converge");
    return api.lifecycle.get(fixture.sandbox);
  }
  async function completed(operationId: string) {
    let record = await api.execution.get({
      sandbox: fixture.sandbox,
      operationId,
    });
    for (
      let attempt = 0;
      record &&
      !["completed", "cancelled", "failed"].includes(record.state) &&
      attempt < polls;
      attempt++
    ) {
      await fixture.beforePoll?.();
      record = await api.execution.status({
        sandbox: fixture.sandbox,
        operationId,
      });
    }
    check(
      record && ["completed", "cancelled", "failed"].includes(record.state),
      "execution did not finish within poll budget",
    );
    return record;
  }
  async function output(operationId: string) {
    const handle = { sandbox: fixture.sandbox, operationId };
    for (let attempt = 0; attempt < polls; attempt++)
      await api.execution.syncLogs(handle);
    let cursor: number | null = null,
      text = "",
      bytes = 0,
      truncated = false,
      previous = -1;
    for (let attempt = 0; attempt < 4; attempt++) {
      const page = await api.execution.logs({ ...handle, cursor, limit: 16 });
      truncated ||= page.truncated;
      for (const entry of page.entries) {
        const size = new TextEncoder().encode(entry.text).length;
        check(
          size <= 4096 && entry.sequence > previous,
          "invalid cached log chunk or ordering",
        );
        previous = entry.sequence;
        bytes += size;
        if (entry.stream === "stdout") text += entry.text;
      }
      if (page.isDone) break;
      check(
        page.nextCursor !== null && page.nextCursor !== cursor,
        "cached log cursor did not advance",
      );
      cursor = page.nextCursor;
    }
    check(bytes <= 65536, "cached output exceeds aggregate limit");
    return { text, bytes, truncated };
  }
  async function image(
    kind: "snapshotDisk" | "createTemplate" | "fork" | "restore",
    source?: Parameters<typeof api.images.run>[0]["image"],
  ) {
    let op: OperationRecord | null = await api.images.run({
      sandbox: fixture.sandbox,
      operationId: kind,
      kind,
      ...(source ? { image: source } : {}),
    });
    for (
      let attempt = 0;
      op?.status !== "succeeded" && attempt < polls;
      attempt++
    ) {
      await fixture.beforePoll?.();
      op = await api.images.status({
        sandbox: fixture.sandbox,
        operationId: kind,
      });
    }
    check(
      op?.status === "succeeded",
      "native image readiness did not converge",
    );
    return op;
  }
  return {
    fixture,
    api,
    capabilities,
    faulted,
    check,
    need,
    file,
    ready,
    lifecycle,
    completed,
    output,
    image,
  };
}
type Context = ReturnType<typeof context>;
const cases: { name: string; run(ctx: Context): Promise<void> }[] = [
  {
    name: "capability declarations",
    run: async ({ fixture, capabilities, check }) => {
      const sdk = fixture.provider.adapter;
      const methods: Partial<Record<Capability, unknown>> = {
        describe: sdk.describe,
        create: sdk.create,
        start: sdk.start,
        stop: sdk.stop,
        delete: sdk.delete,
        resumeMemory: sdk.resumeMemory,
        execute: sdk.execution?.start,
        cancelExecution: sdk.execution?.cancel,
        executionLogs: sdk.execution?.logs,
        readFile: sdk.files?.read,
        writeFile: sdk.files?.write,
        listFiles: sdk.files?.list,
        deleteFile: sdk.files?.delete,
        transferFile: sdk.files?.transfer,
        snapshotDisk: sdk.images?.snapshotDisk,
        createTemplate: sdk.images?.createTemplate,
        fork: sdk.images?.fork,
        restore: sdk.images?.restore,
        listTemplates: sdk.images?.listTemplates,
        getConnection: sdk.connections?.get,
        createFromTemplate: sdk.create,
      };
      for (const capability of capabilities.supported)
        check(
          capability in methods && typeof methods[capability] === "function",
          `missing declared implementation for ${capability}`,
        );
      if (capabilities.supported.includes("getConnection"))
        check(sdk.connections?.kinds.length, "missing native connection kinds");
      if (capabilities.supported.includes("transferFile"))
        check(
          sdk.files?.transferDirections?.length,
          "missing native transfer directions",
        );
    },
  },
  {
    name: "lifecycle and persistence",
    run: async (c) => {
      c.need("create", "describe", "start", "stop", "delete");
      await c.ready();
      const files =
          c.capabilities.supported.includes("readFile") &&
          c.capabilities.supported.includes("writeFile"),
        path = c.file("persistence");
      if (files)
        await c.api.files.writeText({
          sandbox: c.fixture.sandbox,
          path,
          text: "x",
          operationId: "write",
        });
      const stopped = await c.lifecycle("stop");
      c.check(
        stopped && ["stopped", "paused"].includes(stopped.observedState),
        "stop did not reach a resting state",
      );
      const started = await c.lifecycle("start");
      c.check(
        started?.observedState === "running",
        "start did not restore running observation",
      );
      if (files && c.capabilities.persistence?.diskOnStop === "retained")
        c.check(
          (
            await c.api.files.readText({
              sandbox: c.fixture.sandbox,
              path,
              maxBytes: 1,
            })
          ).text === "x",
          "declared disk retention was not preserved",
        );
      if (files && c.capabilities.persistence?.diskOnStop === "discarded") {
        let rejected = false;
        try {
          await c.api.files.read({
            sandbox: c.fixture.sandbox,
            path,
            maxBytes: 1,
          });
        } catch (error) {
          rejected =
            error instanceof SandboxProviderError &&
            error.data.code === "stale_resource";
        }
        c.check(rejected, "declared disk discard was not observed");
      }
      c.check(
        (await c.lifecycle("delete"))?.tombstone,
        "confirmed deletion did not tombstone binding",
      );
    },
  },
  {
    name: "observation ordering",
    run: async (c) => {
      await c.ready();
      const store = c.fixture.stores.lifecycle,
        older = await store.beginRefresh(c.fixture.sandbox),
        newer = await store.beginRefresh(c.fixture.sandbox);
      c.check(
        await store.finishRefresh({
          sandbox: c.fixture.sandbox,
          ...newer,
          result: { state: "running" },
        }),
        "latest observation was rejected",
      );
      c.check(
        !(await store.finishRefresh({
          sandbox: c.fixture.sandbox,
          ...older,
          result: { state: "stopped" },
        })),
        "older observation overwrote newer state",
      );
      c.check(
        (await store.get(c.fixture.sandbox))?.observedState === "running",
        "stale state replaced current observation",
      );
    },
  },
  {
    name: "provisioning concurrency",
    run: async (c) => {
      c.need("create");
      if (await c.fixture.stores.lifecycle.get(c.fixture.sandbox))
        throw new Skip("requires an empty logical sandbox");
      const request = {
        sandbox: c.fixture.sandbox,
        provider: c.fixture.provider.name,
        operationId: "concurrent",
      };
      await Promise.all([
        c.api.lifecycle.create(request),
        c.api.lifecycle.create(request),
      ]);
      c.check(
        c.faulted.faults.counts().create?.dispatched === 1,
        "duplicate provisioning dispatched more than once",
      );
      c.check(
        await c.fixture.stores.lifecycle.get(c.fixture.sandbox),
        "successful provisioning did not bind a resource",
      );
    },
  },
  {
    name: "provisioning rejected retry",
    run: async (c) => {
      c.need("create");
      c.faulted.faults.failNext("create", "before");
      const request = {
        sandbox: c.fixture.sandbox,
        provider: c.fixture.provider.name,
        operationId: "rejected",
      };
      const failed = await c.api.lifecycle.create(request);
      c.check(
        failed.kind === "provision" && failed.provision.status === "failed",
        "rejected work was not recorded as failed",
      );
      await c.api.lifecycle.create(request);
      c.check(
        c.faulted.faults.counts().create?.attempts === 1,
        "a repeated rejected operation was dispatched again",
      );
      await c.api.lifecycle.create({ ...request, operationId: "new-retry" });
      c.check(
        await c.fixture.stores.lifecycle.get(c.fixture.sandbox),
        "a fresh operation could not provision after rejection",
      );
    },
  },
  {
    name: "provisioning lost reply",
    run: async (c) => {
      c.need("create");
      c.faulted.faults.failNext("create", "after");
      const request = {
        sandbox: c.fixture.sandbox,
        provider: c.fixture.provider.name,
        operationId: "lost",
      };
      const lost = await c.api.lifecycle.create(request);
      c.check(
        lost.kind === "provision" && lost.provision.status === "unknown",
        "lost provisioning reply was not unknown",
      );
      await c.api.lifecycle.create(request);
      c.check(
        c.faulted.faults.counts().create?.dispatched === 1,
        "unknown provisioning was repeated",
      );
      if (c.fixture.provider.adapter.findCreate) {
        await c.api.lifecycle.reconcileCreate({
          sandbox: c.fixture.sandbox,
          operationId: "lost",
        });
        c.check(
          await c.fixture.stores.lifecycle.get(c.fixture.sandbox),
          "read-only provisioning lookup did not recover binding",
        );
      }
    },
  },
  {
    name: "execution uncertainty",
    run: async (c) => {
      c.need("execute");
      await c.ready();
      c.faulted.faults.failNext("execution.start", "after");
      const handle = {
        sandbox: c.fixture.sandbox,
        operationId: "lost-command",
      };
      c.check(
        (
          await c.api.execution.start({
            ...handle,
            input: c.fixture.commands.complete,
          })
        ).state === "unknown",
        "lost execution reply was not unknown",
      );
      await c.api.execution.start({
        ...handle,
        input: c.fixture.commands.complete,
      });
      c.check(
        c.faulted.faults.counts()["execution.start"]?.dispatched === 1,
        "unknown execution was started again",
      );
      if (c.fixture.provider.adapter.execution?.find)
        c.check(
          (await c.api.execution.status(handle))?.executionId,
          "read-only execution lookup did not recover handle",
        );
    },
  },
  {
    name: "cancellation acknowledgement",
    run: async (c) => {
      c.need("execute", "cancelExecution");
      await c.ready();
      const handle = {
        sandbox: c.fixture.sandbox,
        operationId: "cancel-command",
      };
      const started = await c.api.execution.start({
        ...handle,
        input: c.fixture.commands.running,
      });
      c.check(
        ["queued", "running"].includes(started.state),
        "running command fixture ended before cancellation",
      );
      const cancelled = await c.api.execution.cancel(handle);
      c.check(
        cancelled?.cancellation.requested,
        "cancellation intent was lost",
      );
      c.check(
        cancelled?.state === started.state,
        "acknowledgement silently changed process state",
      );
      await c.completed(handle.operationId);
    },
  },
  {
    name: "execution logs",
    run: async (c) => {
      c.need("execute", "executionLogs");
      await c.ready();
      const handle = { sandbox: c.fixture.sandbox, operationId: "output" };
      await c.api.execution.start({
        ...handle,
        input: c.fixture.commands.complete,
      });
      const finished = await c.completed(handle.operationId);
      c.check(
        finished?.state === "completed" && finished.exitCode === 0,
        "complete command fixture did not exit successfully",
      );
      c.check(
        (await c.output(handle.operationId)).text === c.fixture.expectedOutput,
        "fixture output was lost or duplicated",
      );
    },
  },
  {
    name: "bounded output",
    run: async (c) => {
      c.need("execute", "executionLogs");
      await c.ready();
      const handle = {
        sandbox: c.fixture.sandbox,
        operationId: "large-output",
      };
      await c.api.execution.start({
        ...handle,
        input: c.fixture.commands.largeOutput,
      });
      await c.completed(handle.operationId);
      const result = await c.output(handle.operationId);
      c.check(
        result.truncated || result.bytes === 65536,
        "large-output fixture did not exercise the output bound",
      );
    },
  },
  {
    name: "files and path guards",
    run: async (c) => {
      c.need("readFile", "writeFile", "listFiles", "deleteFile");
      await c.ready();
      const sandbox = c.fixture.sandbox,
        path = c.file("text"),
        binaryPath = c.file("binary"),
        maxBytes = Math.max(
          1,
          Math.min(8, Math.floor(c.capabilities.limits?.maxFileBytes ?? 8)),
        ),
        text = "x".repeat(maxBytes);
      await c.api.files.writeText({ sandbox, path, text, operationId: "text" });
      c.check(
        (await c.api.files.readText({ sandbox, path, maxBytes })).text === text,
        "text round trip changed content",
      );
      const data = new Uint8Array(
        Array.from({ length: maxBytes }, (_, index) => 255 - index),
      ).buffer;
      await c.api.files.write({
        sandbox,
        path: binaryPath,
        data,
        operationId: "binary",
      });
      const received = new Uint8Array(
        (await c.api.files.read({ sandbox, path: binaryPath, maxBytes })).data,
      );
      c.check(
        received.byteLength === maxBytes &&
          received.every((byte, index) => byte === 255 - index),
        "binary round trip changed content",
      );
      const page = await c.api.files.list({
        sandbox,
        path: c.fixture.fileRoot ?? "/workspace",
        limit: 1,
      });
      c.check(
        page.entries.length <= 1 && typeof page.partial === "boolean",
        "file page exceeded its requested limit",
      );
      const before = c.faulted.faults.counts()["files.read"]?.attempts ?? 0;
      let rejected = false;
      try {
        await c.api.files.read({
          sandbox,
          path: `${c.fixture.fileRoot ?? "/workspace"}/../private`,
          maxBytes: 1,
        });
      } catch {
        rejected = true;
      }
      c.check(
        rejected &&
          (c.faulted.faults.counts()["files.read"]?.attempts ?? 0) === before,
        "traversal reached native file SDK",
      );
      if (c.capabilities.supported.includes("transferFile")) {
        const direction =
          c.fixture.provider.adapter.files?.transferDirections?.[0];
        c.check(direction, "missing transfer direction");
        if (direction)
          await c.api.files.transfer({
            sandbox,
            path,
            direction,
            operationId: "transfer",
            maxBytes,
            expiresInMs: 10000,
          });
      }
      c.check(
        (
          await c.api.files.delete({
            sandbox,
            path,
            operationId: "delete-text",
          })
        ).deleted,
        "native file deletion was not observed",
      );
    },
  },
  {
    name: "optional capability guards",
    run: async (c) => {
      await c.ready();
      const masked = {
          ...c.faulted.provider,
          capabilities: {
            ...c.capabilities,
            supported: c.capabilities.supported.filter(
              (capability) =>
                !["snapshotDisk", "getConnection"].includes(capability),
            ),
          },
        },
        api = clients(masked, c.fixture.stores),
        before = JSON.stringify(c.faulted.faults.counts());
      for (const call of [
        () =>
          api.images.run({
            sandbox: c.fixture.sandbox,
            operationId: "unsupported",
            kind: "snapshotDisk",
          }),
        () =>
          api.images.connection({
            sandbox: c.fixture.sandbox,
            kind: "desktop",
          }),
      ]) {
        let unsupported = false;
        try {
          await call();
        } catch (error) {
          unsupported =
            error instanceof SandboxProviderError &&
            error.data.code === "unsupported";
        }
        c.check(
          unsupported,
          "unadvertised optional feature did not fail as unsupported",
        );
      }
      c.check(
        JSON.stringify(c.faulted.faults.counts()) === before,
        "unsupported capability reached native SDK",
      );
    },
  },
  {
    name: "native images and connections",
    run: async (c) => {
      await c.ready();
      const has = (capability: Capability) =>
        c.capabilities.supported.includes(capability);
      let templateId = c.fixture.templateId;
      let restoreImage = c.fixture.restoreImage;
      if (
        ![
          "snapshotDisk",
          "createTemplate",
          "fork",
          "restore",
          "listTemplates",
          "getConnection",
          "createFromTemplate",
        ].some((capability) => has(capability as Capability))
      )
        throw new Skip("no native image or connection capabilities");
      if (has("snapshotDisk")) {
        const op = await c.image("snapshotDisk"),
          result = op?.nativeImage?.result;
        c.check(
          result &&
            "image" in result &&
            result.image.provider === c.fixture.provider.name &&
            result.image.kind === "disk-snapshot",
          "snapshot lost provider-native identity",
        );
        if (result && "image" in result) restoreImage = result.image;
      }
      if (has("restore")) {
        c.check(
          restoreImage,
          "fixture requires restoreImage or native snapshot creation",
        );
        if (restoreImage) await c.image("restore", restoreImage);
      }
      if (has("fork")) {
        const row = await c.fixture.stores.lifecycle.get(c.fixture.sandbox),
          op = await c.image("fork"),
          result = op?.nativeImage?.result;
        c.check(
          result &&
            "machine" in result &&
            result.machine.provider === c.fixture.provider.name &&
            result.machine.providerId !== row?.reference.providerId,
          "fork did not produce a distinct same-provider machine",
        );
      }
      if (has("createTemplate")) {
        const result = (await c.image("createTemplate"))?.nativeImage?.result;
        c.check(
          result && "image" in result && result.image.kind === "template",
          "template creation did not return a template reference",
        );
        if (result && "image" in result) templateId = result.image.id;
      }
      if (has("listTemplates")) {
        const page = await c.api.images.listTemplates({
          sandbox: c.fixture.sandbox,
          limit: 1,
        });
        c.check(
          page.items.length <= 1 &&
            page.items.every(
              (item) => item.reference.provider === c.fixture.provider.name,
            ),
          "template page crossed provider identity or bounds",
        );
      }
      if (has("createFromTemplate")) {
        c.check(
          templateId,
          "fixture requires templateId or native template creation",
        );
        const target = {
          ...c.fixture.sandbox,
          key: `${c.fixture.sandbox.key}-template`,
        };
        await c.api.lifecycle.create({
          sandbox: target,
          provider: c.fixture.provider.name,
          operationId: "from-template",
          options: { templateId },
        });
        const created = await c.fixture.stores.lifecycle.get(target),
          source = await c.fixture.stores.lifecycle.get(c.fixture.sandbox);
        c.check(
          created &&
            created.reference.provider === c.fixture.provider.name &&
            created.reference.providerId !== source?.reference.providerId,
          "create-from-template did not bind a distinct same-provider machine",
        );
      }
      if (has("getConnection")) {
        const kind = c.fixture.provider.adapter.connections?.kinds[0];
        c.check(kind, "fixture has no connection kind");
        if (kind) {
          const handle = await c.api.images.connection({
            sandbox: c.fixture.sandbox,
            kind,
            expiresInMs: 10000,
          });
          c.check(
            handle.kind === kind && handle.expiresAt > Date.now(),
            "native connection is expired or the wrong kind",
          );
        }
      }
    },
  },
];

/** Runner-neutral cases. Every invocation gets an isolated fixture and always cleans it up. */
export function adapterConformance(
  factory: ConformanceFactory,
): readonly ConformanceCase[] {
  return cases.map((item) => ({
    name: item.name,
    run: async () => {
      let fixture: ConformanceFixture;
      try {
        fixture = await factory();
      } catch {
        throw new ConformanceFailure(item.name, "fixture construction failed");
      }
      let result: ConformanceResult | undefined;
      let failure: ConformanceFailure | undefined;
      try {
        await item.run(context(fixture));
        result = { name: item.name, status: "passed" };
      } catch (error) {
        if (error instanceof Skip)
          result = {
            name: item.name,
            status: "skipped",
            reason: error.message,
          };
        else
          failure = new ConformanceFailure(
            item.name,
            error instanceof ContractAssertion
              ? error.message
              : "adapter call failed",
          );
      }
      try {
        await fixture.cleanup();
      } catch {
        failure = new ConformanceFailure(
          item.name,
          failure
            ? "contract check and fixture cleanup failed"
            : "fixture cleanup failed",
        );
      }
      if (failure) throw failure;
      if (!result)
        throw new ConformanceFailure(item.name, "missing case result");
      return result;
    },
  }));
}
export async function runAdapterConformance(
  factory: ConformanceFactory,
): Promise<ConformanceResult[]> {
  const results: ConformanceResult[] = [];
  for (const item of adapterConformance(factory))
    results.push(await item.run());
  return results;
}
