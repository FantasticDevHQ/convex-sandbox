import { truncateUtf8 } from "../output.js";
import { SandboxProviderError } from "./errors.js";
import {
  executionStateValidator,
  type CommandInput,
  type ExecutionSnapshot,
  type ProviderLogPage,
} from "../execution.js";

const invalid = () => {
  throw new SandboxProviderError({
    code: "validation",
    outcome: "unknown",
    retryable: false,
  });
};
export function validateCommand(input: CommandInput): CommandInput {
  const string = (
    value: unknown,
    max: number,
    empty = false,
  ): value is string =>
    typeof value === "string" &&
    (empty || !!value.length) &&
    value.length <= max &&
    !value.includes("\0");
  if (
    !input ||
    typeof input !== "object" ||
    !["shell", "argv"].includes(input.kind)
  )
    throw new Error("Invalid command");
  const allowed =
    input.kind === "shell"
      ? ["kind", "command", "cwd", "timeoutMs", "env"]
      : ["kind", "executable", "args", "cwd", "timeoutMs", "env"];
  if (
    Object.keys(input).some((key) => !allowed.includes(key)) ||
    (input.cwd !== undefined && !string(input.cwd, 4096)) ||
    (input.timeoutMs !== undefined &&
      (!Number.isSafeInteger(input.timeoutMs) ||
        input.timeoutMs < 1 ||
        input.timeoutMs > 3600000))
  )
    throw new Error("Invalid command");
  let command: CommandInput;
  if (input.kind === "shell") {
    if (!string(input.command, 65536)) throw new Error("Invalid command");
    command = { kind: "shell", command: input.command };
  } else {
    if (
      !string(input.executable, 4096) ||
      !Array.isArray(input.args) ||
      input.args.length > 128 ||
      !Array.from(input.args).every((arg) => string(arg, 4096, true)) ||
      input.args.reduce((length, arg) => length + arg.length, 0) > 65536
    )
      throw new Error("Invalid command");
    command = {
      kind: "argv",
      executable: input.executable,
      args: Object.freeze([...input.args]) as string[],
    };
  }
  if (input.env !== undefined) {
    if (
      !input.env ||
      typeof input.env !== "object" ||
      Array.isArray(input.env) ||
      Object.keys(input.env).length > 64
    )
      throw new Error("Invalid command");
    const env: Record<string, string> = Object.create(null);
    let size = 0;
    for (const [key, value] of Object.entries(input.env)) {
      if (
        !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) ||
        !string(value, 8192, true)
      )
        throw new Error("Invalid command");
      size += key.length + value.length;
      if (size > 32768) throw new Error("Invalid command");
      env[key] = value;
    }
    command.env = Object.freeze(env);
  }
  if (input.cwd !== undefined) command.cwd = input.cwd;
  if (input.timeoutMs !== undefined) command.timeoutMs = input.timeoutMs;
  return Object.freeze(command);
}
export function normalizeSnapshot(
  raw: unknown,
  expectedId?: string,
): ExecutionSnapshot {
  if (!raw || typeof raw !== "object") return invalid();
  const id: unknown = Reflect.get(raw, "executionId");
  const state: unknown = Reflect.get(raw, "state");
  const exitCode: unknown = Reflect.get(raw, "exitCode");
  const output: unknown = Reflect.get(raw, "output");
  if (
    typeof id !== "string" ||
    !id ||
    id.length > 1024 ||
    (expectedId !== undefined && id !== expectedId) ||
    !executionStateValidator.members.some((member) => member.value === state) ||
    (exitCode !== undefined && !Number.isSafeInteger(exitCode)) ||
    (state === "completed" && exitCode === undefined)
  )
    return invalid();
  const snapshot: ExecutionSnapshot = {
    executionId: id,
    state: state as ExecutionSnapshot["state"],
    ...(exitCode !== undefined ? { exitCode: exitCode as number } : {}),
  };
  if (output !== undefined) {
    if (!output || typeof output !== "object") return invalid();
    const stdout: unknown = Reflect.get(output, "stdout"),
      stderr: unknown = Reflect.get(output, "stderr"),
      truncated: unknown = Reflect.get(output, "truncated");
    if (
      typeof stdout !== "string" ||
      typeof stderr !== "string" ||
      typeof truncated !== "boolean"
    )
      return invalid();
    const out = truncateUtf8(stdout, 4096),
      err = truncateUtf8(stderr, 4096);
    snapshot.output = {
      stdout: out.text,
      stderr: err.text,
      truncated: truncated || out.truncated || err.truncated,
    };
  }
  return snapshot;
}
export function normalizeLogPage(raw: unknown): ProviderLogPage {
  if (!raw || typeof raw !== "object") return invalid();
  const entries: unknown = Reflect.get(raw, "entries"),
    cursor: unknown = Reflect.get(raw, "nextCursor"),
    complete: unknown = Reflect.get(raw, "complete"),
    truncated: unknown = Reflect.get(raw, "truncated");
  if (
    !Array.isArray(entries) ||
    (cursor !== null && (typeof cursor !== "string" || cursor.length > 2048)) ||
    typeof complete !== "boolean" ||
    (truncated !== undefined && typeof truncated !== "boolean")
  )
    return invalid();
  const page: ProviderLogPage = {
    entries: [],
    nextCursor: cursor as string | null,
    complete,
    truncated: truncated === true || entries.length > 16,
  };
  let remaining = 16384;
  for (let index = 0; index < Math.min(entries.length, 16); index++) {
    const entry: unknown = entries[index];
    if (!entry || typeof entry !== "object") return invalid();
    const stream: unknown = Reflect.get(entry, "stream"),
      text: unknown = Reflect.get(entry, "text");
    if (
      (stream !== "stdout" && stream !== "stderr") ||
      typeof text !== "string"
    )
      return invalid();
    const bounded = truncateUtf8(text, Math.min(4096, remaining));
    if (bounded.text) page.entries.push({ stream, text: bounded.text });
    remaining -= bounded.bytes;
    page.truncated ||= bounded.truncated;
  }
  return page;
}
