// Maintainer-only smoke runner. Never imported by the component or example app.
import path from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createBoatProvider } from "@fantastic.dev/convex-sandbox/boat";
import { createBoatTransport } from "../../dist/boat/transport.js";
import {
  createInventory,
  readInventory,
  validateApproval,
} from "./live-guard.mjs";

const unsupported = [
  "cancelExecution",
  "transferFile",
  "snapshotDisk",
  "createTemplate",
  "createFromTemplate",
  "restore",
  "suspendMemory",
  "resumeMemory",
  "getConnection",
];
const requireTrue = (value) => {
  if (!value) throw new Error("Live verification failed");
};

/** Call only after explicit operator approval. Inject fetch for deterministic offline tests. */
export async function runLive({
  approval: input,
  inventoryPath,
  apiKey,
  fetch,
  signal,
  clock = Date.now,
  pause = (signal) => delay(1000, undefined, { signal }),
}) {
  const startedAt = clock();
  const approval = validateApproval(input, startedAt);
  const checkout = fileURLToPath(new URL("../../", import.meta.url));
  const target = path.join(
    realpathSync(path.dirname(path.resolve(inventoryPath))),
    path.basename(inventoryPath),
  );
  const relative = path.relative(realpathSync(checkout), target);
  requireTrue(
    relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative),
  );
  const inventory = createInventory(target, approval, clock);
  const controller = new AbortController();
  const workSignal = signal
    ? AbortSignal.any([controller.signal, signal])
    : controller.signal;
  const deadline = Math.min(
    Date.parse(approval.expiresAt),
    startedAt + approval.maxSeconds * 1000,
  );
  const workTimer = setTimeout(
    () => controller.abort(),
    Math.max(0, deadline - clock()),
  );
  const checks = [],
    skipped = [],
    failures = [],
    accepted = [];
  let stage = "preflight",
    adapter,
    checksPassed = false,
    lastNow = startedAt;
  function context(key, signal = workSignal, lifecycleJob) {
    return {
      idempotencyKey: key,
      signal,
      ...(lifecycleJob ? { lifecycleJob } : {}),
    };
  }
  async function work(name, invoke) {
    stage = name;
    const now = clock();
    requireTrue(
      !workSignal.aborted &&
        Number.isFinite(now) &&
        now >= lastNow &&
        now < deadline,
    );
    lastNow = now;
    return invoke();
  }
  async function poll(read, done, signal, attempts = 30) {
    for (let index = 0; index < attempts; index++) {
      requireTrue(!signal.aborted);
      const result = await read();
      if (done(result)) return result;
      if (index + 1 < attempts) await pause(signal);
    }
    throw new Error("Live polling exhausted");
  }
  function reserve(kind, parentId) {
    const intentId = inventory.reserve(approval.accountId, kind, parentId);
    const item = {
      intentId,
      kind,
      parentId: parentId ?? null,
      providerId: null,
      deletionJobId: null,
      cleanup: "not-requested",
    };
    accepted.push(item);
    return item;
  }
  function created(item, providerId) {
    // Retain an accepted native ID in the final report even if persistence fails.
    item.providerId = providerId;
    inventory.created(item.intentId, providerId);
  }
  try {
    const options = {
      apiKey,
      org: "personal",
      machineType: approval.machineType,
      ttlSeconds: approval.ttlSeconds,
      ...(fetch ? { fetch } : {}),
    };
    const provider = createBoatProvider(options);
    adapter = provider.adapter;
    const transport = createBoatTransport(options);
    const userId = await work("account-preflight", () =>
      transport.call("read", context("preflight-me"), async (api, init) => {
        const { raw } = await api.meRaw(init);
        const reply = await raw.json();
        requireTrue(reply.ok === true && reply.user?.id === approval.accountId);
        return reply.user.id;
      }),
    );
    requireTrue(userId === approval.accountId);
    await work("wallet-preflight", () =>
      transport.call("read", context("preflight-limits"), async (api, init) => {
        const { raw } = await api.limitsRaw({ org: "personal" }, init);
        const reply = await raw.json();
        requireTrue(
          reply.ok === true &&
            reply.canStart === true &&
            reply.activeSandboxes === 0 &&
            Number.isSafeInteger(reply.maxActiveSandboxes) &&
            reply.maxActiveSandboxes >= approval.maxMachines &&
            (reply.teamId === undefined || reply.teamId === null),
        );
      }),
    );
    checks.push("account-and-personal-wallet");
    requireTrue(
      unsupported.every(
        (capability) => !provider.capabilities.supported.includes(capability),
      ),
    );
    checks.push("unsupported-capabilities");

    const machine = await work("create", async () => {
      const item = reserve("create");
      const result = await adapter.create({}, context(item.intentId));
      created(item, result.providerId);
      return item.providerId;
    });
    await poll(
      () =>
        work("create-readiness", () =>
          adapter.describe(machine, context("create-status")),
        ),
      (result) => result.state === "running",
      workSignal,
    );
    checks.push("create-and-describe");
    const file = `/tmp/csb-live-${approval.runId}.txt`;
    const bytes = new TextEncoder().encode(`csb-live:${approval.runId}\n`);
    const write = await work("file-write", () =>
      adapter.files.write(machine, file, bytes.buffer, context("file-write")),
    );
    requireTrue(write.complete && write.bytesWritten === bytes.length);
    const readFile = async (id) => {
      const read = await work("file-read", () =>
        adapter.files.read(
          id,
          file,
          { offset: 0, maxBytes: 4096 },
          context("file-read"),
        ),
      );
      requireTrue(
        read.complete &&
          read.totalBytes === bytes.length &&
          Buffer.from(read.data).equals(Buffer.from(bytes)),
      );
    };
    await readFile(machine);
    const listing = await work("file-list", () =>
      adapter.files.list(
        machine,
        "/tmp",
        { cursor: null, maxEntries: 100 },
        context("file-list"),
      ),
    );
    requireTrue(
      listing.entries.some(
        (entry) =>
          entry.name === file.slice("/tmp/".length) && entry.kind === "file",
      ),
    );
    checks.push("file-write-read-list");

    const command = await work("detached-command", () =>
      adapter.execution.start(
        machine,
        {
          kind: "argv",
          executable: "/usr/bin/printf",
          args: ["%s\n", `csb-${approval.runId}`],
        },
        context("command"),
      ),
    );
    const exit = await poll(
      () =>
        work("command-status", () =>
          adapter.execution.status(
            machine,
            command.executionId,
            context("command-status"),
          ),
        ),
      (result) => result.state === "completed" || result.state === "failed",
      workSignal,
    );
    requireTrue(exit.state === "completed" && exit.exitCode === 0);
    let cursor = null,
      stdout = "",
      stderr = "",
      complete = false;
    for (let index = 0; index < 8; index++) {
      const page = await work("command-logs", () =>
        adapter.execution.logs(
          machine,
          command.executionId,
          { cursor, maxBytes: 4096, maxEntries: 2 },
          context("command-logs"),
        ),
      );
      requireTrue(!page.truncated);
      for (const entry of page.entries) {
        if (entry.stream === "stdout") stdout += entry.text;
        else stderr += entry.text;
      }
      requireTrue(
        Buffer.byteLength(stdout) + Buffer.byteLength(stderr) <= 4096,
      );
      if (page.complete) {
        complete = true;
        break;
      }
      requireTrue(page.nextCursor !== null && page.nextCursor !== cursor);
      cursor = page.nextCursor;
    }
    requireTrue(
      complete && stdout === `csb-${approval.runId}\n` && stderr === "",
    );
    checks.push("detached-command-and-logs");
    await work("template-catalog", () =>
      adapter.images.listTemplates(
        machine,
        { cursor: null, limit: 10 },
        context("catalog"),
      ),
    );
    checks.push("source-scoped-template-catalog");

    if (approval.maxMachines === 2) {
      const child = await work("fork", async () => {
        const item = reserve("fork", machine);
        const job = await adapter.images.fork(machine, context(item.intentId));
        requireTrue(job.state === "pending");
        // Pinned adapter's accepted handle publishes the child before readiness GET.
        const value = JSON.parse(job.operationId);
        requireTrue(
          Array.isArray(value) &&
            value.length === 3 &&
            value[0] === "boat-fork-v1" &&
            value[1] === machine &&
            value[2] !== machine,
        );
        created(item, value[2]);
        return { id: item.providerId, job: job.operationId };
      });
      await poll(
        () =>
          work("fork-readiness", () =>
            adapter.images.status(machine, child.job, context("fork-status")),
          ),
        (result) =>
          result.state === "ready" &&
          result.result.machine?.providerId === child.id,
        workSignal,
      );
      await readFile(child.id);
      checks.push("fork-file-copy");
    } else skipped.push("fork-budget");
    const removed = await work("file-delete", () =>
      adapter.files.delete(machine, file, context("file-delete")),
    );
    requireTrue(removed.deleted);
    checks.push("file-delete");
    const stop = await work("stop", () =>
      adapter.stop(machine, context("stop")),
    );
    const stopContext = context(
      "stop-status",
      workSignal,
      stop.lifecycleJob ? { ...stop.lifecycleJob, kind: "stop" } : undefined,
    );
    await poll(
      () => work("stop-status", () => adapter.describe(machine, stopContext)),
      (result) => result.state === "stopped",
      workSignal,
    );
    await work("resume", () => adapter.start(machine, context("resume")));
    await poll(
      () =>
        work("resume-status", () =>
          adapter.describe(machine, context("resume-status")),
        ),
      (result) => result.state === "running",
      workSignal,
    );
    checks.push("stop-and-resume");
    checksPassed = true;
  } catch {
    failures.push({ stage, reason: "verification-failed" });
  } finally {
    clearTimeout(workTimer);
    controller.abort();
    // Cleanup deliberately ignores an interrupted/expired work signal, but has its own bound.
    const cleanupController = new AbortController();
    const timer = setTimeout(() => cleanupController.abort(), 30000);
    try {
      for (const item of [...accepted].reverse()) {
        if (item.providerId === null) continue;
        try {
          requireTrue(!cleanupController.signal.aborted);
          inventory.deleting(item.providerId);
          item.cleanup = "pending";
          const cleanupContext = context(
            `delete-${item.intentId}`,
            cleanupController.signal,
          );
          const deletion = await adapter.delete(
            item.providerId,
            cleanupContext,
          );
          requireTrue(deletion.lifecycleJob?.id);
          item.deletionJobId = deletion.lifecycleJob.id;
          inventory.deletionAccepted(item.providerId, item.deletionJobId);
          if (deletion.state !== "deleted")
            await poll(
              () =>
                adapter.describe(
                  item.providerId,
                  context("delete-status", cleanupController.signal, {
                    id: item.deletionJobId,
                    kind: "delete",
                  }),
                ),
              (result) => result.state === "deleted",
              cleanupController.signal,
              10,
            );
          inventory.deleted(item.providerId, item.deletionJobId);
          item.cleanup = "vm-deleted-snapshots-unverified";
        } catch {
          failures.push({
            stage: "cleanup",
            intentId: item.intentId,
            reason: "cleanup-unresolved",
          });
        }
      }
    } finally {
      clearTimeout(timer);
      try {
        inventory.close();
      } catch {
        failures.push({ stage: "inventory", reason: "inventory-close-failed" });
      }
    }
  }
  let fixtures = accepted,
    inventoryReadable = true;
  try {
    fixtures = readInventory(target).creations.map((saved) => {
      const live = accepted.find((item) => item.intentId === saved.intentId);
      return {
        ...saved,
        providerId: saved.providerId ?? live?.providerId ?? null,
        deletionJobId: saved.deletionJobId ?? live?.deletionJobId ?? null,
      };
    });
  } catch {
    inventoryReadable = false;
    failures.push({ stage: "inventory", reason: "inventory-unreadable" });
  }
  return {
    runId: approval.runId,
    checksPassed,
    cleanupVerified: inventoryReadable && fixtures.length === 0,
    inventoryReadable,
    checks,
    skipped,
    unsupported,
    fixtures,
    failures,
    qualification: "unverified",
    snapshotCleanup: "not-verified",
  };
}
