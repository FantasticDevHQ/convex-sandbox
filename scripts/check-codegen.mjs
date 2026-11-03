import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const generatedPaths = [
  "src/component/_generated",
  "example/convex/_generated",
];

export function assertGeneratedClean(root) {
  const changes = execFileSync(
    "git",
    ["status", "--porcelain", "--untracked-files=all", "--", ...generatedPaths],
    { cwd: root, encoding: "utf8" },
  );
  if (changes.trim())
    throw new Error(
      `Generated bindings differ. Run pnpm codegen and commit the bindings.\n${changes}`,
    );
}

async function generate(check) {
  // These helpers reject foreign state and remove inherited cloud credentials.
  const { state, checkConfig, childEnv, cli } =
    await import("./worktree/config.mjs");
  const { root, backend } = await import("./worktree/context.mjs");
  const s = await state();
  await checkConfig(s, true);
  // codegen has no --env-file flag in this SDK. Empty selectors also prevent
  // dotenv from loading a cloud key from checkout-local .env files.
  const env = {
    ...childEnv(s),
    CONVEX_DEPLOYMENT: `anonymous:${s.deployment}`,
    CONVEX_DEPLOY_KEY: "",
    CONVEX_SELF_HOSTED_URL: "",
    CONVEX_SELF_HOSTED_ADMIN_KEY: "",
  };
  const run = (args, cwd = backend) =>
    execFileSync(process.execPath, args, { cwd, env, stdio: "inherit" });
  const codegen = [
    cli(),
    "codegen",
    "--typecheck",
    "disable",
  ];
  // Published JS components are skipped by ordinary app codegen. Generate TS
  // source explicitly, rebuild the package, then regenerate the consuming app.
  run([...codegen, "--component-dir", path.join(root, "src/component")]);
  run(
    [
      path.join(root, "node_modules/typescript/bin/tsc"),
      "-p",
      "tsconfig.build.json",
    ],
    root,
  );
  run(codegen);
  if (check) assertGeneratedClean(root);
  console.log(
    check
      ? "PASS: component and example generated bindings match Git"
      : "Generated component and example bindings",
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await generate(process.argv.includes("--check"));
}
