// Exercise the installed CLI with all fetches replaced. No backend is started.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const cli = path.join(path.dirname(require.resolve("convex/package.json")), "bin/main.js");
const version = "precompiled-2026-10-22-1447815";

function download(t, scenario) {
  const root = mkdtempSync(path.join(tmpdir(), "convex-download-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "convex"));
  mkdirSync(path.join(root, "home"));
  writeFileSync(path.join(root, "package.json"), '{"name":"offline-download-test","version":"1.0.0","dependencies":{"convex":"1.49.0"}}');
  writeFileSync(path.join(root, "convex.json"), '{"functions":"convex/"}');
  const capture = path.join(root, "requests.jsonl");
  writeFileSync(capture, "");
  const preload = path.join(root, "fetch.cjs");
  writeFileSync(preload, `
    const { appendFileSync } = require("node:fs");
    global.fetch = async (input, options = {}) => {
      const url = String(input);
      appendFileSync(${JSON.stringify(capture)}, JSON.stringify({url, accept: options.headers?.Accept}) + "\\n");
      const reply = (body, status = 200) => new Response(JSON.stringify(body), {status});
      if (url === "https://version.convex.dev/v1/local_backend_version") return reply({version: ${JSON.stringify(version)}});
      if (url.startsWith("https://github.com/convex/convex-backend/releases/download/")) return reply({}, ${scenario === "404" ? 404 : 504});
      if (url === "https://api.github.com/repos/convex/convex-backend/releases/tags/${version}") {
        const filename = ${JSON.stringify(scenario)} === "wrong-name" ? "foreign.zip" :
          ${JSON.stringify(process.platform === "darwin" ? `convex-local-backend-${process.arch === "arm64" ? "aarch64" : "x86_64"}-apple-darwin.zip` : "convex-local-backend-x86_64-unknown-linux-gnu.zip")};
        return reply({tag_name: ${JSON.stringify(scenario === "wrong-tag" ? "another-version" : version)}, assets: [{id: ${scenario === "wrong-id" ? '"123"' : '123'}, name: filename, state: ${JSON.stringify(scenario === "wrong-state" ? "new" : "uploaded")}, url: "https://untrusted.invalid/asset"}]});
      }
      if (url === "https://api.github.com/repos/convex/convex-backend/releases/assets/123") return reply({}, 503);
      throw new Error("Unexpected request: " + url);
    };
  `);
  // An allowlisted environment prevents using the caller's account or deployments.
  const result = spawnSync(process.execPath, ["--require", preload, cli, "dev", "--once", "--local-cloud-port", "3210", "--local-site-port", "3211"], {
    cwd: root,
    env: { PATH: process.env.PATH, HOME: path.join(root, "home"), CI: "true", CONVEX_AGENT_MODE: "anonymous", CONVEX_DISABLE_TELEMETRY: "1" },
    encoding: "utf8", timeout: 20000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.ok(readFileSync(capture, "utf8"), result.stdout + result.stderr);
  return { output: result.stdout + result.stderr, requests: readFileSync(capture, "utf8").trim().split("\n").map(JSON.parse) };
}

test("installed CLI uses exact official asset API after a release server error", (t) => {
  const { output, requests } = download(t, "fallback");
  assert.match(output, /releases\/assets\/123: HTTP 503/);
  assert.equal(requests.length, 4);
  assert.match(requests[1].url, new RegExp(`/releases/download/${version}/convex-local-backend-.*\\.zip$`));
  assert.equal(requests[2].url, `https://api.github.com/repos/convex/convex-backend/releases/tags/${version}`);
  assert.equal(requests[3].accept, "application/octet-stream");
});

test("installed CLI preserves a missing release error without fallback", (t) => {
  const { output, requests } = download(t, "404");
  assert.match(output, /HTTP 404/);
  assert.equal(requests.length, 2);
});

for (const scenario of ["wrong-name", "wrong-id", "wrong-state", "wrong-tag"]) {
  test(`installed CLI refuses release metadata with ${scenario}`, (t) => {
    const { output, requests } = download(t, scenario);
    assert.match(output, /No uploaded asset/);
    assert.equal(requests.length, 3);
  });
}
