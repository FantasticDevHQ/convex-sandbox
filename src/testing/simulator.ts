import {
  registerProvider,
  type SandboxAdapter,
  type ProviderSandbox,
} from "../client/providers.js";
import { SandboxProviderError } from "../client/errors.js";
import type { Capabilities, Capability } from "../capabilities.js";
import type { ExecutionSnapshot } from "../execution.js";
import type { ImageOutput, ImageReference, ImageSnapshot } from "../images.js";
import { filePath } from "../client/fileProtocol.js";
import { validateCommand } from "../client/executionProtocol.js";
import { truncateUtf8 } from "../output.js";
import { instrumentAdapter } from "./faults.js";

export type SimulatedProfile = "ephemeral" | "persistent" | "memory";
interface FixtureFile {
  path: string;
  bytes: number[];
}
interface FixtureExecution {
  id: string;
  key: string;
  state: ExecutionSnapshot["state"];
  exitCode?: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  polls: number;
  cancelled: boolean;
}
interface FixtureMachine {
  id: string;
  state: "running" | "stopped" | "paused" | "deleted";
  files: FixtureFile[];
  executions: FixtureExecution[];
}
interface FixtureImage {
  reference: ImageReference;
  files: FixtureFile[];
  readiness: "pending" | "ready";
}
interface FixtureJob {
  id: string;
  key: string;
  machine: string;
  polls: number;
  output: ImageOutput;
  restoreFiles?: FixtureFile[];
}
export interface SimulatedState {
  version: 1;
  name: string;
  profile: SimulatedProfile;
  idempotency: "native" | "none";
  nextId: number;
  machines: FixtureMachine[];
  creates: { key: string; id: string }[];
  images: FixtureImage[];
  jobs: FixtureJob[];
}
const FILE_BYTES = 65536,
  STATE_BYTES = 524288;
const profiles: readonly SimulatedProfile[] = [
  "ephemeral",
  "persistent",
  "memory",
];
const clone = <T>(value: T): T => structuredClone(value);
function fail(
  code:
    | "validation"
    | "quota"
    | "capacity"
    | "stale_resource"
    | "authorization"
    | "unsupported",
): never {
  throw new SandboxProviderError({
    code,
    outcome: "not_started",
    retryable: false,
  });
}
function path(input: string): string {
  let result: string;
  try {
    result = filePath(input);
  } catch {
    return fail("validation");
  }
  if (result !== "/workspace" && !result.startsWith("/workspace/"))
    return fail("authorization");
  return result;
}
function number(value: number, max: number, min = 0) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail("validation");
  return value;
}
function validateState(input: unknown): SimulatedState {
  const raw = input as SimulatedState;
  const invalid = (): never => {
    throw new Error("Invalid simulated state");
  };
  try {
    if (
      raw?.version !== 1 ||
      typeof raw.name !== "string" ||
      !/^[a-z][a-z\d-]{0,63}$/.test(raw.name) ||
      !profiles.includes(raw.profile) ||
      !["native", "none"].includes(raw.idempotency) ||
      !Number.isSafeInteger(raw.nextId) ||
      raw.nextId < 0 ||
      !Array.isArray(raw.machines) ||
      raw.machines.length > 8 ||
      !Array.isArray(raw.images) ||
      raw.images.length > 16 ||
      !Array.isArray(raw.jobs) ||
      raw.jobs.length > 32 ||
      !Array.isArray(raw.creates) ||
      raw.creates.length > 64
    )
      return invalid();
    let minimumBytes = 0;
    const keys = (value: object, fields: string[]) => {
      if (Object.keys(value).some((key) => !fields.includes(key))) invalid();
    };
    keys(raw, [
      "version",
      "name",
      "profile",
      "idempotency",
      "nextId",
      "machines",
      "creates",
      "images",
      "jobs",
    ]);
    const usedIds = new Set<string>();
    const native = (value: string, kind: string) => {
      const prefix = `sim-${kind}-`,
        suffix = value.startsWith(prefix) ? value.slice(prefix.length) : "";
      const number = Number(suffix);
      if (
        !/^[1-9]\d*$/.test(suffix) ||
        !Number.isSafeInteger(number) ||
        number > raw.nextId ||
        usedIds.has(value)
      )
        invalid();
      usedIds.add(value);
    };
    const id = (value: unknown) => {
      if (typeof value !== "string" || !value || value.length > 8192) invalid();
    };
    const files = (items: FixtureFile[]) => {
      if (!Array.isArray(items) || items.length > 64) invalid();
      for (const file of items) {
        keys(file, ["path", "bytes"]);
        minimumBytes +=
          (file.bytes?.length ?? STATE_BYTES) * 2 +
          (file.path?.length ?? STATE_BYTES);
        if (minimumBytes > STATE_BYTES) invalid();
        if (
          path(file.path) !== file.path ||
          !Array.isArray(file.bytes) ||
          file.bytes.length > FILE_BYTES ||
          file.bytes.some(
            (byte) => !Number.isInteger(byte) || byte < 0 || byte > 255,
          )
        )
          invalid();
      }
      if (new Set(items.map((file) => file.path)).size !== items.length)
        invalid();
    };
    for (const machine of raw.machines) {
      keys(machine, ["id", "state", "files", "executions"]);
      id(machine.id);
      native(machine.id, "vm");
      if (
        !["running", "stopped", "paused", "deleted"].includes(machine.state) ||
        !Array.isArray(machine.executions) ||
        machine.executions.length > 32
      )
        invalid();
      files(machine.files);
      for (const job of machine.executions) {
        keys(job, [
          "id",
          "key",
          "state",
          "exitCode",
          "stdout",
          "stderr",
          "truncated",
          "polls",
          "cancelled",
        ]);
        id(job.id);
        native(job.id, "exec");
        id(job.key);
        minimumBytes +=
          (job.stdout?.length ?? STATE_BYTES) +
          (job.stderr?.length ?? STATE_BYTES);
        if (minimumBytes > STATE_BYTES) invalid();
        if (
          !["queued", "running", "completed", "cancelled", "failed"].includes(
            job.state,
          ) ||
          typeof job.stdout !== "string" ||
          job.stdout.length > FILE_BYTES ||
          typeof job.stderr !== "string" ||
          job.stderr.length > FILE_BYTES ||
          typeof job.cancelled !== "boolean" ||
          typeof job.truncated !== "boolean"
        )
          invalid();
        number(job.polls, 32);
        if (job.exitCode !== undefined) number(job.exitCode, 255);
      }
    }
    for (const create of raw.creates) {
      keys(create, ["key", "id"]);
      id(create.key);
      if (!raw.machines.some((machine) => machine.id === create.id)) invalid();
    }
    for (const image of raw.images) {
      keys(image, ["reference", "files", "readiness"]);
      keys(image.reference, ["provider", "id", "kind"]);
      if (
        image.reference.provider !== raw.name ||
        !["template", "disk-snapshot"].includes(image.reference.kind) ||
        !["pending", "ready"].includes(image.readiness)
      )
        invalid();
      id(image.reference.id);
      native(image.reference.id, "image");
      files(image.files);
    }
    for (const job of raw.jobs) {
      keys(job, ["id", "key", "machine", "polls", "output", "restoreFiles"]);
      id(job.id);
      native(job.id, "image-job");
      id(job.key);
      number(job.polls, 32);
      if (!raw.machines.some((machine) => machine.id === job.machine))
        invalid();
      if (job.restoreFiles) files(job.restoreFiles);
      const output = job.output;
      keys(output, [
        "image" in output
          ? "image"
          : "machine" in output
            ? "machine"
            : "restored",
      ]);
      if ("image" in output) keys(output.image, ["id", "kind", "provider"]);
      if ("machine" in output) keys(output.machine, ["provider", "providerId"]);
      if (
        "image" in output
          ? !raw.images.some(
              (image) =>
                image.reference.id === output.image.id &&
                output.image.provider === raw.name,
            )
          : "machine" in output
            ? output.machine.provider !== raw.name ||
              !raw.machines.some(
                (machine) => machine.id === output.machine.providerId,
              )
            : output.restored !== true
      )
        invalid();
    }
    if (
      new Set(raw.machines.map((machine) => machine.id)).size !==
        raw.machines.length ||
      new TextEncoder().encode(JSON.stringify(raw)).byteLength > STATE_BYTES
    )
      invalid();
    return clone(raw);
  } catch {
    return invalid();
  }
}

/** Pure, bounded fixture interpreter. No OS filesystem, process, shell or network APIs. */
export function createSimulatedProvider(
  options: {
    name?: string;
    profile?: SimulatedProfile;
    idempotency?: "native" | "none";
    state?: unknown;
    now?: () => number;
  } = {},
) {
  let state = options.state
    ? validateState(options.state)
    : validateState({
        version: 1,
        name: options.name ?? "simulated",
        profile: options.profile ?? "persistent",
        idempotency: options.idempotency ?? "native",
        nextId: 0,
        machines: [],
        creates: [],
        images: [],
        jobs: [],
      });
  if (
    (options.name && options.name !== state.name) ||
    (options.profile && options.profile !== state.profile) ||
    (options.idempotency && options.idempotency !== state.idempotency)
  )
    throw new Error("Invalid simulated state");
  const now = options.now ?? Date.now;
  function mutate<T>(call: () => T): T {
    const before = clone(state);
    try {
      const result = call();
      if (
        new TextEncoder().encode(JSON.stringify(state)).byteLength > STATE_BYTES
      )
        fail("quota");
      return result;
    } catch (error) {
      state = before;
      throw error;
    }
  }
  function machine(id: string, running = false) {
    const found = state.machines.find((item) => item.id === id);
    if (!found || found.state === "deleted") return fail("stale_resource");
    if (running && found.state !== "running") return fail("capacity");
    return found;
  }
  const description = (item: FixtureMachine): ProviderSandbox => ({
    providerId: item.id,
    state: item.state,
    resources: { cpuCount: 1, memoryMiB: 1024, diskMiB: 4096 },
  });
  const next = (kind: string) => `sim-${kind}-${++state.nextId}`;
  function write(item: FixtureMachine, input: string, data: ArrayBuffer) {
    const selected = path(input);
    if (selected === "/workspace") fail("validation");
    if (!(data instanceof ArrayBuffer) || data.byteLength > FILE_BYTES)
      fail("quota");
    const existing = item.files.find((file) => file.path === selected);
    if (!existing && item.files.length >= 64) fail("quota");
    const bytes = [...new Uint8Array(data)];
    if (existing) existing.bytes = bytes;
    else item.files.push({ path: selected, bytes });
  }
  function read(item: FixtureMachine, input: string) {
    const found = item.files.find((file) => file.path === path(input));
    if (!found) return fail("stale_resource");
    return found;
  }
  function execution(item: FixtureMachine, id: string) {
    const job = item.executions.find((entry) => entry.id === id);
    return job ?? fail("stale_resource");
  }
  const executionSnapshot = (job: FixtureExecution): ExecutionSnapshot => ({
    executionId: job.id,
    state: job.state,
    ...(job.exitCode === undefined ? {} : { exitCode: job.exitCode }),
  });
  function newMachine(files: FixtureFile[] = []) {
    if (state.machines.length >= 8) fail("quota");
    const item: FixtureMachine = {
      id: next("vm"),
      state: "running",
      files: clone(files),
      executions: [],
    };
    state.machines.push(item);
    return item;
  }
  function imageJob(
    id: string,
    key: string,
    kind: "snapshotDisk" | "createTemplate" | "fork" | "restore",
    reference?: ImageReference,
  ): ImageSnapshot {
    const item = machine(id, true),
      prior = state.jobs.find((job) => job.key === key && job.machine === id);
    if (prior)
      return prior.polls === 0
        ? { state: "ready", result: clone(prior.output) }
        : { state: "pending", operationId: prior.id };
    if (state.jobs.length >= 32) fail("quota");
    let output: ImageOutput, restoreFiles: FixtureFile[] | undefined;
    if (kind === "restore") {
      const source = state.images.find(
        (image) =>
          image.reference.provider === reference?.provider &&
          image.reference.id === reference?.id &&
          image.reference.kind === reference?.kind &&
          image.readiness === "ready",
      );
      if (!source) return fail("stale_resource");
      output = { restored: true };
      restoreFiles = clone(source.files);
    } else if (kind === "fork")
      output = {
        machine: {
          provider: state.name,
          providerId: newMachine(item.files).id,
        },
      };
    else {
      if (state.images.length >= 16) fail("quota");
      const image = {
        reference: {
          provider: state.name,
          id: next("image"),
          kind:
            kind === "snapshotDisk"
              ? ("disk-snapshot" as const)
              : ("template" as const),
        },
        files: clone(item.files),
        readiness: "pending" as const,
      };
      state.images.push(image);
      output = { image: image.reference };
    }
    const job: FixtureJob = {
      id: next("image-job"),
      key,
      machine: id,
      polls: 1,
      output,
      ...(restoreFiles ? { restoreFiles } : {}),
    };
    state.jobs.push(job);
    return { state: "pending", operationId: job.id };
  }
  function imageStatus(id: string, jobId: string): ImageSnapshot {
    machine(id);
    const job = state.jobs.find(
      (item) => item.machine === id && item.id === jobId,
    );
    if (!job) return fail("stale_resource");
    job.polls = Math.max(0, job.polls - 1);
    if (job.polls > 0) return { state: "pending", operationId: job.id };
    if ("image" in job.output) {
      const imageId = job.output.image.id;
      const image = state.images.find((item) => item.reference.id === imageId);
      if (!image) return fail("stale_resource");
      image.readiness = "ready";
    }
    if (job.restoreFiles) {
      machine(id).files = clone(job.restoreFiles);
      delete job.restoreFiles;
    }
    return { state: "ready", result: clone(job.output) };
  }
  const supported: Capability[] = [
    "create",
    "describe",
    "start",
    "stop",
    "delete",
    "execute",
    "cancelExecution",
    "executionLogs",
    "readFile",
    "writeFile",
    "listFiles",
    "deleteFile",
  ];
  if (state.profile !== "ephemeral")
    supported.push(
      "createFromTemplate",
      "snapshotDisk",
      "createTemplate",
      "fork",
      "restore",
      "listTemplates",
      "getConnection",
      "transferFile",
    );
  if (state.profile === "memory") supported.push("resumeMemory");
  const capabilities: Capabilities = {
    version: 1,
    supported,
    limits: { maxFileBytes: FILE_BYTES },
    persistence: {
      diskOnStop: state.profile === "ephemeral" ? "discarded" : "retained",
      memoryOnStop: state.profile === "memory" ? "retained" : "discarded",
    },
    nativeFeatures: [`${state.name}.fixtureInterpreter`],
  };
  const adapter: SandboxAdapter = {
    describe: async (id) => {
      const found = state.machines.find((item) => item.id === id);
      return found ? description(found) : fail("stale_resource");
    },
    create: async (input, context) =>
      mutate(() => {
        if (
          input.resources &&
          ((input.resources.cpuCount !== undefined &&
            input.resources.cpuCount !== 1) ||
            (input.resources.memoryMiB !== undefined &&
              input.resources.memoryMiB !== 1024) ||
            (input.resources.diskMiB !== undefined &&
              input.resources.diskMiB !== 4096))
        )
          fail("unsupported");
        const prior =
          state.idempotency === "native" &&
          state.creates.find((item) => item.key === context.idempotencyKey);
        if (prior) return description(machine(prior.id));
        if (state.creates.length >= 64) fail("quota");
        let files: FixtureFile[] = [];
        if (input.templateId) {
          if (state.profile === "ephemeral") fail("unsupported");
          const image = state.images.find(
            (item) =>
              item.reference.id === input.templateId &&
              item.readiness === "ready",
          );
          if (!image) return fail("stale_resource");
          files = image.files;
        }
        const item = newMachine(files);
        state.creates.push({ key: context.idempotencyKey, id: item.id });
        return description(item);
      }),
    findCreate: async (key) => {
      const found = state.creates.find((item) => item.key === key);
      return found ? description(machine(found.id)) : null;
    },
    stop: async (id) =>
      mutate(() => {
        const item = machine(id);
        item.state = state.profile === "memory" ? "paused" : "stopped";
        if (state.profile === "ephemeral") item.files = [];
        if (state.profile !== "memory")
          for (const job of item.executions)
            if (["queued", "running"].includes(job.state)) job.state = "failed";
        return description(item);
      }),
    start: async (id) =>
      mutate(() => {
        const item = machine(id);
        if (item.state === "paused") fail("unsupported");
        item.state = "running";
        return description(item);
      }),
    delete: async (id) =>
      mutate(() => {
        const item = machine(id);
        item.state = "deleted";
        item.files = [];
        item.executions = [];
        return description(item);
      }),
    files: {
      read: async (id, input, request) => {
        const file = read(machine(id, true), input);
        number(request.offset, file.bytes.length);
        number(request.maxBytes, FILE_BYTES, 1);
        const bytes = file.bytes.slice(
          request.offset,
          request.offset + request.maxBytes,
        );
        return {
          data: new Uint8Array(bytes).buffer,
          offset: request.offset,
          totalBytes: file.bytes.length,
          complete: request.offset + bytes.length >= file.bytes.length,
        };
      },
      write: async (id, input, data) =>
        mutate(() => {
          write(machine(id, true), input, data);
          return { bytesWritten: data.byteLength, complete: true };
        }),
      delete: async (id, input) =>
        mutate(() => {
          const item = machine(id, true),
            selected = path(input),
            index = item.files.findIndex((file) => file.path === selected);
          if (index < 0) return { deleted: false };
          item.files.splice(index, 1);
          return { deleted: true };
        }),
      list: async (id, input, request) => {
        const item = machine(id, true),
          root = path(input),
          offset =
            request.cursor === null ? 0 : number(Number(request.cursor), 64);
        number(request.maxEntries, 100, 1);
        const entries = new Map<
          string,
          { name: string; kind: "file" | "directory"; sizeBytes?: number }
        >();
        for (const file of item.files) {
          if (!file.path.startsWith(`${root}/`)) continue;
          const tail = file.path.slice(root.length + 1),
            parts = tail.split("/"),
            name = parts[0];
          entries.set(
            name,
            parts.length > 1
              ? { name, kind: "directory" }
              : { name, kind: "file", sizeBytes: file.bytes.length },
          );
        }
        const all = [...entries.values()].sort((a, b) =>
            a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
          ),
          page = all.slice(offset, offset + request.maxEntries),
          end = offset + page.length;
        return {
          entries: page,
          nextCursor: end < all.length ? String(end) : null,
          complete: end >= all.length,
        };
      },
    },
    execution: {
      idempotency: state.idempotency,
      start: async (id, raw, context) =>
        mutate(() => {
          const input = validateCommand(raw);
          if (input.kind !== "argv") return fail("unsupported");
          if (input.executable !== "fixture") return fail("validation");
          const item = machine(id, true),
            prior =
              state.idempotency === "native" &&
              item.executions.find((job) => job.key === context.idempotencyKey);
          if (prior) return executionSnapshot(prior);
          if (item.executions.length >= 32) fail("quota");
          let stdout = "",
            stderr = "",
            exitCode = 0,
            polls = 0,
            truncated = false;
          const [instruction, ...args] = input.args;
          if (instruction === "echo") stdout = `${args.join(" ")}\n`;
          else if (instruction === "exit")
            exitCode = number(Number(args[0]), 255);
          else if (instruction === "progress") {
            polls = number(Number(args[0]), 32, 1);
            stdout = `${args.slice(1).join(" ")}\n`;
          } else if (instruction === "generate") {
            const count = number(Number(args[0]), 1048576);
            stdout = "x".repeat(Math.min(count, FILE_BYTES));
            truncated = count > FILE_BYTES;
          } else if (instruction === "write" && args.length === 2)
            write(item, args[0], new TextEncoder().encode(args[1]).buffer);
          else if (instruction === "read" && args.length === 1)
            stdout = new TextDecoder().decode(
              new Uint8Array(read(item, args[0]).bytes),
            );
          else {
            exitCode = 127;
            stderr = "Unsupported fixture instruction\n";
          }
          const bounded = truncateUtf8(stdout, FILE_BYTES);
          stdout = bounded.text;
          truncated ||= bounded.truncated;
          const job: FixtureExecution = {
            id: next("exec"),
            key: context.idempotencyKey,
            state: polls ? "queued" : "completed",
            ...(polls ? {} : { exitCode }),
            stdout,
            stderr,
            truncated,
            polls,
            cancelled: false,
          };
          item.executions.push(job);
          return executionSnapshot(job);
        }),
      status: async (id, executionId) =>
        mutate(() => {
          const item = machine(id),
            job = execution(item, executionId);
          if (
            ["queued", "running"].includes(job.state) &&
            item.state === "running"
          ) {
            if (job.cancelled) job.state = "cancelled";
            else {
              job.polls = Math.max(0, job.polls - 1);
              job.state = job.polls ? "running" : "completed";
              if (!job.polls) job.exitCode = 0;
            }
          }
          return executionSnapshot(job);
        }),
      find: async (id, key) => {
        const job = machine(id).executions.find((item) => item.key === key);
        return job ? executionSnapshot(job) : null;
      },
      cancel: async (id, executionId) =>
        mutate(() => {
          const job = execution(machine(id), executionId);
          const acknowledged = ["queued", "running"].includes(job.state);
          if (acknowledged) job.cancelled = true;
          return { acknowledged };
        }),
      logs: async (id, executionId, request) => {
        const job = execution(machine(id), executionId);
        number(request.maxEntries, 16, 1);
        number(request.maxBytes, 16384, 1);
        if (["queued", "running"].includes(job.state))
          return { entries: [], nextCursor: request.cursor, complete: false };
        const total = job.stdout.length + job.stderr.length;
        let offset =
          request.cursor === null ? 0 : number(Number(request.cursor), total);
        const entries: { stream: "stdout" | "stderr"; text: string }[] = [];
        let remaining = request.maxBytes;
        while (
          offset < total &&
          entries.length < request.maxEntries &&
          remaining > 0
        ) {
          const stream = offset < job.stdout.length ? "stdout" : "stderr";
          const text = job[stream],
            start = offset - (stream === "stderr" ? job.stdout.length : 0);
          const code = text.charCodeAt(start);
          if (code >= 0xdc00 && code <= 0xdfff) fail("validation");
          const part = truncateUtf8(
            text.slice(start),
            Math.min(4096, remaining),
          );
          if (!part.text) {
            if (!entries.length) fail("validation");
            break;
          }
          entries.push({ stream, text: part.text });
          offset += part.text.length;
          remaining -= part.bytes;
        }
        return {
          entries,
          nextCursor: offset < total ? String(offset) : null,
          complete: offset >= total,
          truncated: job.truncated,
        };
      },
    },
  };
  if (state.profile === "memory")
    adapter.resumeMemory = async (id) =>
      mutate(() => {
        const item = machine(id);
        if (item.state !== "paused") fail("validation");
        item.state = "running";
        return description(item);
      });
  if (state.profile !== "ephemeral") {
    adapter.images = {
      snapshotDisk: async (id, context) =>
        mutate(() => imageJob(id, context.idempotencyKey, "snapshotDisk")),
      createTemplate: async (id, context) =>
        mutate(() => imageJob(id, context.idempotencyKey, "createTemplate")),
      fork: async (id, context) =>
        mutate(() => imageJob(id, context.idempotencyKey, "fork")),
      restore: async (id, image, context) =>
        mutate(() => imageJob(id, context.idempotencyKey, "restore", image)),
      status: async (id, jobId) => mutate(() => imageStatus(id, jobId)),
      find: async (id, key) => {
        const job = state.jobs.find(
          (item) => item.machine === id && item.key === key,
        );
        return job
          ? job.polls
            ? { state: "pending", operationId: job.id }
            : { state: "ready", result: clone(job.output) }
          : null;
      },
      listTemplates: async (id, request) => {
        machine(id);
        number(request.limit, 100, 1);
        const offset =
            request.cursor === null ? 0 : number(Number(request.cursor), 16),
          items = state.images
            .slice(offset, offset + request.limit)
            .map((image) => ({
              reference: clone(image.reference),
              readiness: image.readiness,
            })),
          end = offset + items.length;
        return {
          items,
          nextCursor: end < state.images.length ? String(end) : null,
          complete: end >= state.images.length,
        };
      },
    };
    adapter.connections = {
      kinds:
        state.profile === "memory"
          ? ["preview", "desktop", "browser", "ssh"]
          : ["preview"],
      get: async (id, request) => {
        if (
          !(
            state.profile === "memory"
              ? ["preview", "desktop", "browser", "ssh"]
              : ["preview"]
          ).includes(request.kind)
        )
          fail("unsupported");
        machine(id, true);
        number(request.expiresInMs, 300000, 1);
        return {
          kind: request.kind,
          url: `${request.kind === "ssh" ? "ssh" : "https"}://simulated.invalid/${id}/${request.kind}`,
          expiresAt: now() + Math.max(1, request.expiresInMs - 100),
          access: { kind: request.kind === "ssh" ? "ssh-key" : "public" },
          ...(request.kind === "ssh" ? { username: "fixture" } : {}),
        };
      },
    };
    if (adapter.files) {
      adapter.files.transferDirections = ["download"];
      adapter.files.transfer = async (id, input, request) => {
        if (request.direction !== "download") return fail("unsupported");
        const file = read(machine(id, true), input);
        number(request.expiresInMs, 300000, 1);
        number(request.maxBytes, FILE_BYTES, 1);
        return {
          url: `https://simulated.invalid/${id}/download`,
          method: "GET",
          expiresAt: now() + Math.max(1, request.expiresInMs - 100),
          maxBytes: request.maxBytes,
          totalBytes: file.bytes.length,
          partial: file.bytes.length > request.maxBytes,
        };
      };
    }
  }
  const wrapped = instrumentAdapter(
    registerProvider({
      name: state.name,
      adapter,
      capabilities,
      createIdempotency: state.idempotency,
    }),
  );
  return { ...wrapped, snapshot: (): SimulatedState => clone(state) };
}
