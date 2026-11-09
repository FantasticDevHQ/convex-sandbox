import { test } from "node:test";
import assert from "node:assert/strict";

const project = {
  id: 3397663,
  slug: "convex-sandbox",
  teamId: 419366,
  teamSlug: "fantastic-dev",
};
const secret = "synthetic-boat-key-do-not-print";
async function subject() {
  return import("./boat-config.mjs");
}
function management(
  metadata = project,
  items = [{ name: "BOAT_API_KEY", value: secret, deploymentTypes: ["dev"] }],
) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push(String(url));
    assert.equal(
      options.headers.Authorization,
      "Bearer synthetic-management-token",
    );
    assert.equal(options.redirect, "error");
    if (String(url) === "https://api.convex.dev/v1/projects/3397663")
      return Response.json(metadata);
    assert.equal(
      String(url),
      "https://api.convex.dev/v1/projects/3397663/list_default_environment_variables?name=BOAT_API_KEY&deploymentType=dev",
    );
    return Response.json({ items, pagination: { hasMore: false } });
  };
  return { fetch, calls };
}
test("source identity: approved project/team and Development-only exact key", async () => {
  const { readSharedBoatKey } = await subject();
  const source = management();
  assert.equal(
    await readSharedBoatKey("synthetic-management-token", source.fetch),
    secret,
  );
  assert.equal(source.calls.length, 2);
});
test("source identity: wrong team/project refuses before reading any default", async () => {
  const { readSharedBoatKey } = await subject();
  for (const field of Object.keys(project)) {
    const source = management({ ...project, [field]: "wrong" });
    await assert.rejects(
      readSharedBoatKey("synthetic-management-token", source.fetch),
      /approved source/,
    );
    assert.equal(source.calls.length, 1);
  }
});
test("source identity: refuses missing, duplicate, preview, unrelated and paginated defaults", async () => {
  const { readSharedBoatKey } = await subject();
  for (const items of [
    [],
    [{ name: "BOAT_API_KEY", value: secret, deploymentTypes: ["preview"] }],
    [{ name: "OTHER", value: secret, deploymentTypes: ["dev"] }],
    [{ name: "BOAT_API_KEY", value: "", deploymentTypes: ["dev"] }],
    [1, 2].map(() => ({
      name: "BOAT_API_KEY",
      value: secret,
      deploymentTypes: ["dev"],
    })),
  ]) {
    await assert.rejects(
      readSharedBoatKey(
        "synthetic-management-token",
        management(project, items).fetch,
      ),
    );
  }
  await assert.rejects(
    readSharedBoatKey("synthetic-management-token", async (url) =>
      Response.json(
        String(url).endsWith("3397663")
          ? project
          : { items: [], pagination: { hasMore: true } },
      ),
    ),
  );
});
test("target isolation: writes only exact loopback backend, one key, no redirect", async () => {
  const { writeBoatKey } = await subject();
  const calls = [];
  const target = {
    deployment: "anonymous-alpha",
    ports: { cloud: 18001, site: 18002 },
    adminKey: "synthetic-admin",
  };
  await writeBoatKey(target, secret, async (url, options) => {
    calls.push(url);
    assert.equal(
      url,
      "http://127.0.0.1:18001/api/update_environment_variables",
    );
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "Convex synthetic-admin");
    assert.deepEqual(JSON.parse(options.body), {
      changes: [{ name: "BOAT_API_KEY", value: secret }],
    });
    return new Response("{}");
  });
  assert.equal(calls.length, 1);
  for (const invalid of [
    { ...target, deployment: "calculating-tortoise-488" },
    { ...target, ports: { cloud: "https://cloud.invalid", site: 18002 } },
    { ...target, adminKey: "" },
  ]) {
    await assert.rejects(
      writeBoatKey(invalid, secret, () => assert.fail("must not dispatch")),
    );
  }
});
test("secret output: transport errors and response bodies never escape", async () => {
  const { readSharedBoatKey, writeBoatKey } = await subject();
  for (const fetch of [
    async () => {
      throw new Error(secret);
    },
    async () => new Response(secret, { status: 403 }),
  ]) {
    await assert.rejects(
      readSharedBoatKey("synthetic-management-token", fetch),
      (error) => !String(error).includes(secret),
    );
    await assert.rejects(
      writeBoatKey(
        {
          deployment: "anonymous-alpha",
          ports: { cloud: 18001, site: 18002 },
          adminKey: "synthetic-admin",
        },
        secret,
        fetch,
      ),
      (error) => !String(error).includes(secret),
    );
  }
});

test("secret output: malformed management JSON is suppressed", async () => {
  const { readSharedBoatKey } = await subject();
  await assert.rejects(
    readSharedBoatKey("synthetic-management-token", async () => ({
      ok: true,
      json: async () => {
        throw new Error(secret);
      },
    })),
    (error) => !String(error).includes(secret),
  );
});

import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import http from "node:http";
import { once } from "node:events";
const moduleUrl = new URL("./boat-import.mjs", import.meta.url).href;
const cliPath = new URL("./cli.mjs", import.meta.url).pathname;
async function execute(cwd, registry, code, args = []) {
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", code, "--", ...args],
    {
      cwd,
      env: { ...process.env, WORKTREE_REGISTRY_DIR: registry },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (data) => (output += data));
  child.stderr.on("data", (data) => (output += data));
  const [status] = await once(child, "exit");
  return { status, output };
}
test("target isolation and secret output: actual command writes only one managed worktree", async () => {
  const base = await realpath(
    await mkdtemp(path.join(tmpdir(), "boat-import-")),
  );
  const registry = path.join(base, "registry");
  const received = [[], []];
  let failWrite = false;
  const servers = [];
  const supervisors = [];
  try {
    const leases = {};
    const states = [];
    for (const index of [0, 1]) {
      const root = path.join(base, String(index));
      const server = http.createServer((req, res) => {
        let body = "";
        req.on("data", (data) => (body += data));
        req.on("end", () => {
          received[index].push(JSON.parse(body));
          res.writeHead(failWrite ? 403 : 200);
          res.end(failWrite ? body : "{}");
        });
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      servers.push(server);
      const s = {
        version: 1,
        root,
        id: `owner-${index}`,
        deployment: `anonymous-${index}`,
        ports: {
          cloud: server.address().port,
          site: 10001 + index,
          web: 11001 + index,
        },
      };
      states.push(s);
      await mkdir(path.join(root, "scripts"), { recursive: true });
      await mkdir(path.join(root, ".worktree"), { recursive: true });
      await mkdir(path.join(root, ".convex/local/default"), {
        recursive: true,
      });
      await writeFile(path.join(root, "scripts/worktree.config.json"), "{}");
      await writeFile(
        path.join(root, ".worktree/local.json"),
        JSON.stringify(s),
      );
      await writeFile(
        path.join(root, ".convex/local/default/config.json"),
        JSON.stringify({
          deploymentName: s.deployment,
          ports: s.ports,
          adminKey: `synthetic-admin-${index}`,
        }),
      );
      const supervisor = spawn(
        process.execPath,
        ["-e", "setInterval(()=>{},1000)", cliPath, `--owner=${s.id}`],
        { stdio: "ignore" },
      );
      supervisors.push(supervisor);
      await writeFile(
        path.join(root, ".worktree/runtime.json"),
        JSON.stringify({ pid: supervisor.pid }),
      );
      leases[root] = { id: s.id, ports: s.ports };
    }
    await mkdir(registry);
    await writeFile(path.join(registry, "leases.json"), JSON.stringify(leases));
    const code = `
      try {
        const {importBoatKey} = await import(${JSON.stringify(moduleUrl)});
        await importBoatKey({accessToken:"synthetic-management-token",managementFetch:async url => Response.json(String(url).endsWith("3397663") ? ${JSON.stringify(project)} : {items:[{name:"BOAT_API_KEY",value:${JSON.stringify(secret)},deploymentTypes:["dev"]}],pagination:{hasMore:false}})});
      } catch(error) {console.error(error.message);process.exitCode=1;}
    `;
    const result = await execute(states[0].root, registry, code);
    assert.equal(result.status, 0, result.output);
    assert.equal(result.output.includes(secret), false);
    assert.match(result.output, /Imported BOAT_API_KEY/);
    assert.deepEqual(received[0], [
      { changes: [{ name: "BOAT_API_KEY", value: secret }] },
    ]);
    assert.deepEqual(received[1], []);
    for (const s of states) {
      const config = await readFile(
        path.join(s.root, ".convex/local/default/config.json"),
        "utf8",
      );
      assert.equal(config.includes(secret), false);
    }
    // The server receives the supplied key, then echoes it in a failing response.
    // Captured command output must suppress that body and omit success output.
    failWrite = true;
    const rejectedWrite = await execute(states[0].root, registry, code);
    assert.equal(rejectedWrite.status, 1);
    assert.equal(rejectedWrite.output.includes(secret), false);
    assert.match(rejectedWrite.output, /Local key import failed/);
    assert.doesNotMatch(rejectedWrite.output, /Imported BOAT_API_KEY/);
    assert.equal(received[0].length, 2);
    assert.equal(received[0][1].changes[0].value, secret);
    assert.deepEqual(received[1], []);
    failWrite = false;
    // Released reservations and missing supervisors refuse before any source read.
    const unread = `try { const {importBoatKey}=await import(${JSON.stringify(moduleUrl)}); await importBoatKey({accessToken:"synthetic",managementFetch:()=>{console.log("UNEXPECTED_SOURCE_READ");throw new Error();}}); } catch(error) {console.error(error.message);process.exitCode=1;}`;
    await writeFile(path.join(registry, "leases.json"), "{}");
    const released = await execute(states[0].root, registry, unread);
    assert.equal(released.status, 1);
    assert.equal(released.output.includes("UNEXPECTED_SOURCE_READ"), false);
    await writeFile(path.join(registry, "leases.json"), JSON.stringify(leases));
    await writeFile(path.join(states[0].root, ".worktree/runtime.json"), "{}");
    const stopped = await execute(states[0].root, registry, unread);
    assert.equal(stopped.status, 1);
    assert.equal(stopped.output.includes("UNEXPECTED_SOURCE_READ"), false);
    await writeFile(
      path.join(states[0].root, ".worktree/runtime.json"),
      JSON.stringify({ pid: supervisors[0].pid }),
    );
    // Foreign config refuses before a source read.
    await writeFile(
      path.join(states[0].root, ".convex/local/default/config.json"),
      JSON.stringify({
        deploymentName: "calculating-tortoise-488",
        ports: states[0].ports,
        adminKey: secret,
      }),
    );
    const refused = await execute(states[0].root, registry, code);
    assert.equal(refused.status, 1);
    assert.equal(refused.output.includes(secret), false);
    assert.equal(received[0].length, 2);
    const cli = await execute(
      states[0].root,
      registry,
      `await import(${JSON.stringify(new URL("./boat-import-cli.mjs", import.meta.url).href)});`,
      ["--unexpected"],
    );
    assert.equal(cli.status, 1);
    assert.equal(cli.output.includes(secret), false);
  } finally {
    for (const child of supervisors) {
      child.kill();
      await once(child, "exit");
    }
    for (const server of servers)
      await new Promise((resolve) => server.close(resolve));
    await rm(base, { recursive: true, force: true });
  }
});
