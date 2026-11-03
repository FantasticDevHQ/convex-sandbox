import { execFileSync } from "node:child_process";

export function prepareCheckout(root, command) {
  if (command === undefined) return;
  if (
    !Array.isArray(command) ||
    !command.length ||
    command.some((value) => typeof value !== "string" || !value)
  )
    throw new Error(
      "prepareCommand must be a non-empty array of command arguments.",
    );
  const [executable, ...args] = command;
  execFileSync(executable, args, { cwd: root, stdio: "inherit" });
}
