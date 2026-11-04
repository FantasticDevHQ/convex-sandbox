import { spawnSync } from "node:child_process";
import { convexTest } from "convex-test";
import { defineSchema } from "convex/server";
import { expect, test } from "vitest";
import {
  register,
  createTestStores,
} from "@fantastic.dev/convex-sandbox/testing";
import {
  SandboxProviders,
  type CommandInput,
} from "@fantastic.dev/convex-sandbox";
import { createBoatProvider } from "@fantastic.dev/convex-sandbox/boat";

const sandbox = { scope: "boat-execution-fixture", key: "machine" };
const id = "vm-1";
const handle = { sandbox, operationId: "command" };
const ctx = () => ({
  idempotencyKey: "command-key",
  signal: new AbortController().signal,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
async function fixture() {
  const state = {
    status: "running",
    exitCode: 0 as number | null,
    mode: "detached",
    commandId: "cmd-1",
    sandboxId: id,
    lost: false,
    missingId: false,
    missingHistory: false,
  };
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const provider = createBoatProvider({
    apiKey: "synthetic-execution-key",
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (init.method === "POST") {
        if (state.lost) throw new Error("synthetic-private-error");
        return json({
          ok: true,
          success: true,
          type: "command.started",
          processId: 42,
          pid: 42,
          ...(state.missingId ? {} : { commandId: "cmd-1" }),
          command: "synthetic-private-command",
        });
      }
      if (state.missingHistory) return json({}, 404);
      return json({
        ok: true,
        command: {
          commandId: state.commandId,
          sandboxId: state.sandboxId,
          mode: state.mode,
          status: state.status,
          exitCode: state.exitCode,
          command: "synthetic-private-command",
          stdout: "synthetic-private-output",
        },
      });
    },
  });
  const t = convexTest(defineSchema({}), {
    "./_generated/server.js": () =>
      import("../../example/convex/_generated/server.js"),
  });
  const c = register(t);
  const stores = createTestStores(t, c, () => true);
  await t.mutation(c.registry.ensure, {
    sandbox,
    reference: { provider: "boat", providerId: id },
  });
  const client = () => {
    const providers = new SandboxProviders({ authorize: async () => {} });
    providers.register(provider);
    return providers.execution(stores.execution);
  };
  return { state, calls, provider, client, stores, t, c };
}

test("detached start persists a durable command ID and reads native history without PID lookup or output", async () => {
  const f = await fixture();
  const started = await f
    .client()
    .start({ ...handle, input: { kind: "shell", command: "printf private" } });
  expect(started).toMatchObject({
    state: "running",
    executionId: "cmd-1",
    idempotency: "none",
  });
  expect(JSON.parse(String(f.calls[0].init.body))).toEqual({
    command: "printf private",
    detached: true,
    stream: false,
  });
  expect(f.provider.adapter.execution?.find).toBeUndefined();
  f.state.status = "exited";
  f.state.exitCode = 7;
  expect(await f.client().status(handle)).toMatchObject({
    state: "completed",
    exitCode: 7,
    executionId: "cmd-1",
  });
  expect(f.calls[1].url).toBe(
    "https://boat.dev/api/v1/sandboxes/vm-1/command-history/cmd-1",
  );
  expect(
    (await f.stores.lifecycle.getOperation(sandbox, handle.operationId))
      ?.status,
  ).toBe("failed");
  expect(JSON.stringify(await f.client().get(handle))).not.toContain(
    "synthetic-private",
  );
});

test.each(["lost", "missingId"] as const)(
  "ambiguous start (%s) remains unknown and never redispatches",
  async (failure) => {
    const f = await fixture();
    f.state[failure] = true;
    const input = {
      ...handle,
      input: { kind: "shell" as const, command: "printf once" },
    };
    await f.client().start(input);
    await f.client().start(input);
    expect(await f.client().status(handle)).toMatchObject({ state: "unknown" });
    expect(f.calls).toHaveLength(1);
    expect((await f.client().get(handle))?.executionId).toBeUndefined();
  },
);

test.each(["lost", "failed", "future-status"])(
  "native %s without a reliable outcome stays unknown",
  async (phase) => {
    const f = await fixture();
    await f
      .client()
      .start({ ...handle, input: { kind: "shell", command: "printf once" } });
    f.state.status = phase;
    expect(await f.client().status(handle)).toMatchObject({
      state: "unknown",
      executionId: "cmd-1",
    });
  },
);

test.each(["timed_out", "killed"])(
  "native %s is terminal failure, not a transport timeout or assumed cancellation",
  async (phase) => {
    const f = await fixture();
    await f
      .client()
      .start({ ...handle, input: { kind: "shell", command: "printf once" } });
    f.state.status = phase;
    f.state.exitCode = null;
    expect(await f.client().status(handle)).toMatchObject({
      state: "failed",
      executionId: "cmd-1",
    });
  },
);

test.each(["commandId", "sandboxId", "mode"] as const)(
  "foreign history %s cannot complete the execution",
  async (field) => {
    const f = await fixture();
    await f
      .client()
      .start({ ...handle, input: { kind: "shell", command: "printf once" } });
    f.state[field] = "foreign";
    f.state.status = "exited";
    expect(await f.client().status(handle)).toMatchObject({
      state: "unknown",
      errorCode: "validation",
    });
    expect(f.calls.filter((c) => c.init.method === "POST")).toHaveLength(1);
  },
);

test("expired history and missing exit code never imply success", async () => {
  const f = await fixture();
  await f
    .client()
    .start({ ...handle, input: { kind: "shell", command: "printf once" } });
  f.state.status = "exited";
  f.state.exitCode = null;
  expect(await f.client().status(handle)).toMatchObject({ state: "unknown" });
  f.state.missingHistory = true;
  expect(await f.client().status(handle)).toMatchObject({
    state: "unknown",
    errorCode: "stale_resource",
  });
  expect(f.calls.filter((c) => c.init.method === "POST")).toHaveLength(1);
});

test("argv metacharacters remain literal and cannot select a shell builtin", async () => {
  const f = await fixture();
  const args = [
    "a b",
    "'quotes\"",
    "$SENTINEL",
    "$(printf WRONG)",
    "; printf WRONG;#",
    "a\nb",
    "",
    "-n",
    "trailing\\",
  ];
  await f.provider.adapter.execution?.start(
    id,
    { kind: "argv", executable: "/usr/bin/printf", args: ["%s\\0", ...args] },
    ctx(),
  );
  const command = JSON.parse(String(f.calls[0].init.body)).command;
  const result = spawnSync("/bin/sh", ["-c", command], {
    encoding: "utf8",
    env: { PATH: "/usr/bin:/bin", SENTINEL: "expanded" },
  });
  expect(result.status).toBe(0);
  expect(result.stdout.split("\0").slice(0, -1)).toEqual(args);
  await f.provider.adapter.execution?.start(
    id,
    { kind: "argv", executable: "eval", args: ["printf WRONG"] },
    ctx(),
  );
  const builtin = spawnSync(
    "/bin/sh",
    ["-c", JSON.parse(String(f.calls[1].init.body)).command],
    { encoding: "utf8", env: { PATH: "/usr/bin:/bin" } },
  );
  expect(builtin.status).not.toBe(0);
  expect(builtin.stdout).toBe("");
});

test.each([
  { kind: "shell", command: "true", env: { SECRET: "synthetic" } },
  { kind: "shell", command: "true", timeoutMs: 1000 },
  { kind: "shell", command: "true", cwd: "/tmp" },
  { kind: "shell", command: "true", cwd: "../outside" },
  { kind: "argv", executable: "NAME=value", args: ["sh"] },
] as CommandInput[])(
  "unsupported input is rejected before command dispatch: %j",
  async (input) => {
    const f = await fixture();
    await expect(
      f.provider.adapter.execution?.start(id, input, ctx()),
    ).rejects.toMatchObject({
      data: { code: "unsupported", outcome: "not_started" },
    });
    expect(f.calls).toHaveLength(0);
  },
);

test("native cwd and explicit shell text are preserved without wrapper interpolation", async () => {
  const f = await fixture();
  await f.provider.adapter.execution?.start(
    id,
    { kind: "shell", command: "printf '$HOME'; true", cwd: "project/a b" },
    ctx(),
  );
  expect(JSON.parse(String(f.calls[0].init.body))).toEqual({
    command: "printf '$HOME'; true",
    cwd: "project/a b",
    detached: true,
    stream: false,
  });
});

test.each([
  { kind: "shell", command: "x\0y" },
  { kind: "shell", command: "\ud800" },
  { kind: "argv", executable: "true", args: Array(15).fill("'".repeat(4096)) },
  { kind: "shell", command: "😀".repeat(20000) },
] as CommandInput[])(
  "invalid or expanded oversized command fails before dispatch",
  async (input) => {
    const f = await fixture();
    await expect(
      f.provider.adapter.execution?.start(id, input, ctx()),
    ).rejects.toMatchObject({
      data: { code: "validation", outcome: "not_started" },
    });
    expect(f.calls).toHaveLength(0);
  },
);
