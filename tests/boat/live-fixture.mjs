import assert from "node:assert/strict";
import path from "node:path";

// Synthetic protocol boundary shared by library and CLI tests; never forwards HTTP.
const json = (body, status = 200) =>
  new Response(JSON.stringify({ ok: true, ...body }), { status });
export function fakeBoatHTTP(approval, options = {}) {
  const calls = [];
  const machines = new Map();
  let number = 0;
  const fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    assert.equal(u.origin, "https://boat.dev");
    assert.equal(new Headers(init.headers).get("X-Boat-Org"), "personal");
    assert.equal(init.redirect, "error");
    const p = u.pathname
      .slice("/api/v1/".length)
      .split("/")
      .map(decodeURIComponent);
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ p, method, body });
    options.onRequest?.(p, method);
    if (options.signal && p[0] === options.signalAt) options.signal.abort();
    if (p[0] === "me")
      return json({
        user: {
          id: options.accountId ?? approval.accountId,
          email: "synthetic-private@example.invalid",
        },
      });
    if (p[0] === "limits") {
      assert.equal(u.searchParams.get("org"), "personal");
      return json({
        canStart: options.canStart ?? true,
        activeSandboxes: options.activeSandboxes ?? 0,
        maxActiveSandboxes: 10,
        ...(options.teamId ? { teamId: options.teamId } : {}),
      });
    }
    if (p[0] === "saved-snapshots") {
      assert.equal(method, "GET");
      return json({ snapshots: [] });
    }
    if (p[0] === "deletion-operations") {
      const id = p[1].slice("delete-".length);
      return json({
        operation: {
          id: p[1],
          kind: "sandbox",
          targetId: options.wrongTarget ? "existing-user-vm" : id,
          status: options.pendingDeletion ? "pending" : "completed",
        },
      });
    }
    assert.equal(p[0], "sandboxes");
    if (!p[1]) {
      assert.equal(method, "POST");
      assert.equal(body.noEnv, true);
      assert.equal(body.snapshots, true);
      assert.equal(body.type, "small");
      assert.equal(body.visibility, "private");
      assert.equal(body.ttlSeconds, approval.ttlSeconds);
      if (options.lostCreate) throw new Error("synthetic-private-key-and-body");
      const id = `owned-${++number}`;
      machines.set(id, {
        state: options.neverReady ? "provisioning" : "ready",
        files: new Map(),
        guestFailures: options.guestFailures ?? 0,
      });
      options.acceptedCreate?.();
      return json({ sandbox: { id, state: machines.get(id).state } });
    }
    const id = p[1];
    assert.notEqual(id, "existing-user-vm");
    const machine = machines.get(id);
    assert.ok(machine, `Unexpected target ${id}`);
    if (p[2] === "fork") {
      assert.equal(body.noEnv, true);
      assert.deepEqual(body.env, {});
      if (options.lostFork) throw new Error("synthetic-private-key-and-body");
      const child = `owned-${++number}`;
      machines.set(child, {
        state: "ready",
        files: new Map(machine.files),
        guestFailures: options.forkGuestFailures ?? 0,
      });
      return json({ id: child, sandbox: { id: child, state: "provisioning" } });
    }
    if (p[2] === "stop") {
      machine.state = "archived";
      return json({ id, stop: { id: `stop-${id}`, status: "completed" } });
    }
    if (p[2] === "stops")
      return json({ id, stop: { id: p[3], status: "completed" } });
    if (p[2] === "resume") {
      assert.equal(body.noEnv, true);
      machine.state = "ready";
      return json({ id, sandbox: { id, state: "provisioning" } });
    }
    if (p[2] === "commands") {
      assert.equal(method, "POST");
      assert.equal(body.detached, true);
      assert.match(body.command, /printf/);
      machine.output = `csb-${approval.runId}\n`;
      return json({
        success: true,
        type: "command.started",
        commandId: `cmd-${id}`,
      });
    }
    if (p[2] === "command-history") {
      if (p[4] !== "logs")
        return json({
          command: {
            commandId: p[3],
            sandboxId: id,
            mode: "detached",
            status: "exited",
            exitCode: options.commandFailure ? 1 : 0,
          },
        });
      const stream = u.searchParams.get("stream");
      const content = stream === "stdout" ? machine.output : "";
      const bytes = Buffer.from(content);
      return json({
        commandId: p[3],
        stream,
        encoding: "base64",
        offset: 0,
        nextOffset: bytes.length,
        size: bytes.length,
        data: bytes.toString("base64"),
        done: true,
      });
    }
    if (p[2] === "files") {
      const target = body?.path ?? u.searchParams.get("path");
      assert.ok(
        target === "/tmp" || target === `/tmp/csb-live-${approval.runId}.txt`,
      );
      if (machine.guestFailures > 0) {
        if (p[3] === "list") machine.guestFailures--;
        return json({ private: "synthetic-private-agent-not-ready" }, 503);
      }
      if (options.failFiles)
        return json({ private: "synthetic-private-key-and-body" }, 403);
      if (p[3] === "list")
        return json({
          success: true,
          path: target,
          truncated: false,
          files: [...machine.files].map(([file, bytes]) => ({
            name: path.basename(file),
            path: file,
            isDir: false,
            isSymlink: false,
            size: bytes.length,
          })),
        });
      if (method === "PUT")
        machine.files.set(target, Buffer.from(body.content, "base64"));
      if (method === "DELETE") {
        machine.files.delete(target);
        return json({ success: true, path: target });
      }
      const bytes = machine.files.get(target);
      return json({
        success: true,
        path: target,
        encoding: "base64",
        size: bytes.length,
        ...(method === "GET" ? { content: bytes.toString("base64") } : {}),
      });
    }
    if (method === "DELETE") {
      if (options.lostDelete) throw new Error("synthetic-private-key-and-body");
      return json(
        {
          operation: {
            id: `delete-${id}`,
            kind: "sandbox",
            targetId: id,
            status: "pending",
          },
        },
        202,
      );
    }
    return json({ sandbox: { id, state: machine.state } });
  };
  return { calls, machines, fetch };
}
