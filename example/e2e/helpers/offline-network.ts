import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
/** Exhaustive deterministic transport. No fallback calls the ambient fetch. */
export class SyntheticBoatHTTP {
  readonly escapes: string[] = [];
  readonly requests: string[] = [];
  failureReplies = 0;
  readonly mutations: string[] = [];
  readonly deletionJobs = new Set<string>();
  failFileReads = false;
  readonly disks = new Map<string, Map<string, Buffer>>([
    ["offline-parent", new Map()],
  ]);
  readonly states = new Map<string, string>([["offline-parent", "ready"]]);
  async fetch(input: unknown, init?: RequestInit): Promise<Response> {
    const url = new URL(String(input)),
      method = init?.method ?? "GET",
      path = url.pathname;
    const key = `${method} ${path}`;
    const allow = (body: unknown, status = 200) => {
      this.requests.push(key);
      if (method !== "GET") this.mutations.push(key);
      return response({ ok: true, ...(body as object) }, status);
    };
    if (url.origin !== "https://boat.dev") return this.escape(key);
    if (method === "GET" && path === "/api/v1/me")
      return allow({ user: { id: "offline-account" } });
    if (method === "GET" && path === "/api/v1/limits")
      return allow({ canStart: true });
    if (method === "POST" && path === "/api/v1/sandboxes")
      return allow({ sandbox: { id: "offline-parent", state: "ready" } }, 202);
    if (method === "GET" && path === "/api/v1/saved-snapshots")
      return allow({
        snapshots: [
          {
            name: "offline-base",
            sourceSandboxId: "offline-parent",
            status: "saving",
          },
        ],
      });
    const deletion =
      /^\/api\/v1\/deletion-operations\/delete-(offline-parent|offline-child)$/.exec(
        path,
      );
    if (method === "GET" && deletion && this.deletionJobs.has(deletion[1])) {
      const targetId = deletion[1];
      this.states.set(targetId, "deleted");
      return allow({
        operation: {
          id: `delete-${targetId}`,
          kind: "sandbox",
          targetId,
          status: "completed",
        },
      });
    }
    const match =
      /^\/api\/v1\/sandboxes\/(offline-parent|offline-child)(.*)$/.exec(path);
    if (!match) return this.escape(key);
    const [, id, suffix] = match,
      disk = this.disks.get(id);
    if (!disk) return this.escape(key);
    if (method === "GET" && suffix === "")
      return allow({ sandbox: { id, state: this.states.get(id) } });
    if (method === "POST" && suffix === "/fork" && id === "offline-parent") {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.noEnv, true);
      assert.deepEqual(body.env, {});
      this.disks.set("offline-child", new Map(disk));
      this.states.set("offline-child", "ready");
      return allow({
        id: "offline-child",
        sandbox: { id: "offline-child", state: "provisioning" },
      });
    }
    if (method === "POST" && suffix === "/stop") {
      this.states.set(id, "archived");
      return allow({ id, stop: { id: `stop-${id}`, status: "pending" } });
    }
    if (method === "GET" && suffix === `/stops/stop-${id}`)
      return allow({ id, stop: { id: `stop-${id}`, status: "completed" } });
    if (method === "POST" && suffix === "/resume") {
      this.states.set(id, "ready");
      return allow({ id, state: "provisioning" });
    }
    if (method === "DELETE" && suffix === "") {
      this.deletionJobs.add(id);
      return allow(
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
    if (method === "PUT" && suffix === "/files") {
      const body = JSON.parse(String(init?.body)),
        bytes = Buffer.from(body.content, "base64");
      disk.set(body.path, bytes);
      return allow({
        success: true,
        path: body.path,
        encoding: "base64",
        size: bytes.length,
      });
    }
    if (method === "GET" && suffix === "/files") {
      if (this.failFileReads) {
        this.failureReplies++;
        return response(
          { error: { message: "synthetic native failure" } },
          500,
        );
      }
      const file = url.searchParams.get("path") ?? "",
        bytes = disk.get(file) ?? Buffer.alloc(0);
      return allow({
        success: true,
        path: file,
        encoding: "base64",
        size: bytes.length,
        content: bytes.toString("base64"),
      });
    }
    if (method === "GET" && suffix === "/files/list") {
      const root = url.searchParams.get("path") ?? "";
      return allow({
        success: true,
        path: root,
        truncated: false,
        files: [...disk]
          .filter(([file]) => file.startsWith(`${root}/`))
          .map(([file, data]) => ({
            name: file.split("/").at(-1),
            path: file,
            size: data.length,
            isDir: false,
            isSymlink: false,
          })),
      });
    }
    if (method === "POST" && suffix === "/commands")
      return allow({
        success: true,
        type: "command.started",
        commandId: "offline-history",
        pid: 123,
        processId: 123,
      });
    if (method === "GET" && suffix === "/command-history/offline-history")
      return allow({
        command: {
          commandId: "offline-history",
          sandboxId: id,
          mode: "detached",
          status: "exited",
          exitCode: 0,
        },
      });
    if (
      method === "GET" &&
      suffix === "/command-history/offline-history/logs"
    ) {
      const stream = url.searchParams.get("stream"),
        offset = Number(url.searchParams.get("offset")),
        bytes = Buffer.from(stream === "stdout" ? "mounted output\n" : ""),
        data = bytes.subarray(
          offset,
          offset + Number(url.searchParams.get("limit")),
        );
      return allow({
        type: "command.logs",
        commandId: "offline-history",
        stream,
        offset,
        nextOffset: offset + data.length,
        size: bytes.length,
        encoding: "base64",
        data: data.toString("base64"),
        done: true,
      });
    }
    return this.escape(key);
  }
  private escape(key: string): never {
    this.escapes.push(key);
    throw Error(`Unexpected provider request: ${key}`);
  }
  assertClean() {
    assert.deepEqual(
      this.escapes,
      [],
      `Unexpected provider request: ${this.escapes.join(", ")}`,
    );
  }
}
export async function trapBrowserNetwork(page: Page, origin: string) {
  const escaped: string[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    escaped.push(`${route.request().method()} ${url.origin}${url.pathname}`);
    await route.abort("blockedbyclient");
  });
  await page.routeWebSocket("**/*", (socket) => {
    const url = new URL(socket.url());
    if (url.host === new URL(origin).host && url.protocol === "ws:") {
      socket.connectToServer();
      return;
    }
    escaped.push(`WEBSOCKET ${url.origin}${url.pathname}`);
    socket.close({ code: 1008, reason: "Unexpected offline network request" });
  });
  return {
    assertClean: () =>
      assert.deepEqual(
        escaped,
        [],
        `Unexpected browser request: ${escaped.join(", ")}`,
      ),
  };
}
