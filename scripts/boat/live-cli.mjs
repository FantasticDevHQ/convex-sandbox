// Explicit maintainer command. Read-only modes never load the SDK or read keys.
import { readFileSync, lstatSync } from "node:fs";
import { validateApproval, readInventory } from "./live-guard.mjs";

const args = process.argv.slice(2);
const [mode, file, inventoryPath, flag, acknowledgedRun] = args;
function plan() {
  const info = lstatSync(file);
  if (!info.isFile() || info.size > 16384) throw new Error("Invalid plan");
  return validateApproval(JSON.parse(readFileSync(file, "utf8")));
}
const print = (value) => console.log(JSON.stringify(value, null, 2));
let message =
  "Boat command refused. Use --check-plan PLAN, --report INVENTORY, or --live PLAN INVENTORY --approved-run RUN_ID.";
try {
  if (mode === "--check-plan" && args.length === 2) {
    const approval = plan();
    print({
      valid: true,
      runId: approval.runId,
      maxMachines: approval.maxMachines,
      maxSeconds: approval.maxSeconds,
      budgetUsd: approval.budgetUsd,
      liveAuthorized: false,
    });
  } else if (mode === "--report" && args.length === 2) {
    const state = readInventory(file);
    print({
      runId: state.approval.runId,
      fixtures: state.creations,
      qualification: "unverified",
      readOnly: true,
    });
    process.exitCode = state.creations.length ? 2 : 0;
  } else if (
    mode === "--live" &&
    args.length === 5 &&
    flag === "--approved-run"
  ) {
    message = "Live approval refused before provisioning.";
    const approval = plan();
    if (acknowledgedRun !== approval.runId) throw new Error("Run mismatch");
    message = "Live credential is missing or invalid; provisioning refused.";
    const apiKey = process.env.BOAT_API_KEY;
    if (
      !apiKey ||
      apiKey.length > 4096 ||
      /\s/.test(apiKey) ||
      [...apiKey].some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      throw new Error("Missing key");
    message =
      "Live run did not finish; inspect the private inventory. Cleanup is not verified.";
    const { runLive } = await import("./live-runner.mjs");
    const controller = new AbortController();
    const interrupt = () => controller.abort();
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", interrupt);
    try {
      const report = await runLive({
        approval,
        inventoryPath,
        apiKey,
        signal: controller.signal,
      });
      print(report);
      process.exitCode =
        report.checksPassed && report.cleanupVerified
          ? 0
          : report.checksPassed
            ? 2
            : 1;
    } finally {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", interrupt);
    }
  } else throw new Error("Invalid mode");
} catch {
  console.error(message);
  process.exitCode = 1;
}
