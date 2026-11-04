import { SandboxProviderError } from "../client/errors.js";
import { validateCommand } from "../client/executionProtocol.js";
import type {
  CommandInput,
  ExecutionAdapter,
  ExecutionSnapshot,
} from "../execution.js";
import { createBoatLogs } from "./logs.js";
import { decode, identity, invalid, object } from "./protocol.js";
import type { createBoatTransport } from "./transport.js";

const unsupported = () =>
  new SandboxProviderError({
    code: "unsupported",
    capability: "execute",
    outcome: "not_started",
    retryable: false,
  });
const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;
function commandRequest(raw: CommandInput) {
  let input: CommandInput;
  try {
    input = validateCommand(raw);
  } catch {
    throw new SandboxProviderError({
      code: "validation",
      outcome: "not_started",
      retryable: false,
    });
  }
  if (
    input.env !== undefined ||
    input.timeoutMs !== undefined ||
    (input.cwd !== undefined &&
      (input.cwd.startsWith("/") || input.cwd.split("/").includes(".."))) ||
    (input.kind === "argv" && input.executable.includes("="))
  )
    throw unsupported();
  // Boat accepts shell text only. env forces external executable lookup rather
  // than interpreting a shell builtin; every user token is a POSIX literal.
  const command =
    input.kind === "shell"
      ? input.command
      : `/usr/bin/env -- ${[input.executable, ...input.args].map(quote).join(" ")}`;
  try {
    encodeURIComponent(command);
    if (input.cwd !== undefined) encodeURIComponent(input.cwd);
    if (new TextEncoder().encode(command).length > 65536) throw new Error();
  } catch {
    throw new SandboxProviderError({
      code: "validation",
      outcome: "not_started",
      retryable: false,
    });
  }
  return {
    command,
    ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
    detached: true,
    stream: false,
  };
}

/** Command history IDs survive host action boundaries; PIDs are never handles. */
export function createBoatExecution(
  transport: ReturnType<typeof createBoatTransport>,
): ExecutionAdapter {
  return {
    idempotency: "none",
    logs: createBoatLogs(transport),
    async start(providerId, input, context) {
      identity(providerId);
      const commandRequestBody = commandRequest(input);
      return transport.call("write", context, async (api, init) => {
        const reply = await decode(
          api.commandRaw(
            { sandboxId: providerId, commandRequest: commandRequestBody },
            init,
          ),
          "write",
        );
        if (reply.type !== "command.started" || reply.success !== true)
          throw invalid("write");
        try {
          identity(reply.commandId as string);
        } catch {
          throw invalid("write");
        }
        return { executionId: reply.commandId as string, state: "running" };
      });
    },
    async status(providerId, executionId, context) {
      identity(providerId);
      identity(executionId);
      return transport.call("read", context, async (api, init) => {
        const reply = await decode(
          api.getCommandRaw(
            { sandboxId: providerId, commandId: executionId },
            init,
          ),
          "read",
        );
        const command = object(reply.command);
        if (
          command?.commandId !== executionId ||
          command.sandboxId !== providerId ||
          command.mode !== "detached" ||
          typeof command.status !== "string"
        )
          throw invalid("read");
        const result: ExecutionSnapshot = { executionId, state: "unknown" };
        if (command.status === "running") result.state = "running";
        if (["timed_out", "killed"].includes(command.status))
          result.state = "failed";
        if (
          command.status === "exited" &&
          Number.isSafeInteger(command.exitCode)
        ) {
          result.state = "completed";
          result.exitCode = command.exitCode as number;
        }
        // "failed" includes lost agent results; "lost" follows a VM restart.
        // Neither proves a process exit or permits redispatch.
        return result;
      });
    },
  };
}
