import assert from "node:assert/strict";
import { test } from "node:test";
import { collectSamples, checkSamples } from "../../scripts/check-docs.mjs";

test("Boat host guide is registered with the checked sample gate", async () => {
  const samples = (await collectSamples()).filter((sample) =>
    sample.name.startsWith("boat/guide.md-"),
  );
  assert.equal(samples.length, 1);
  const result = await checkSamples(samples);
  assert.equal(result.status, 0, result.output);
});

// node:test isolates this file's environment from the invoking shell/other files.
test("the exact guide action authenticates ownership/configuration and returns no provider secret", async () => {
  const { convexTest } = await import("convex-test");
  const { defineSchema, makeFunctionReference } = await import("convex/server");
  const { register } = await import("@fantastic.dev/convex-sandbox/testing");
  const { pathToFileURL } = await import("node:url");
  const samples = (await collectSamples()).filter((sample) =>
    sample.name.startsWith("boat/guide.md-"),
  );
  assert.equal(samples.length, 1);
  process.env.BOAT_API_KEY = "";
  process.env.BOAT_ORG = "personal";
  const nativeFetch = globalThis.fetch;
  let calls = 0,
    status = 200;
  const key = "synthetic-server-only-boat-key";
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(String(url), "https://boat.dev/api/v1/sandboxes/owned-vm");
    assert.equal(init.method, "GET");
    assert.equal(
      new Headers(init.headers).get("Authorization"),
      `Bearer ${key}`,
    );
    return new Response(
      JSON.stringify(
        status === 200
          ? {
              ok: true,
              sandbox: {
                id: "owned-vm",
                state: "ready",
                vcpu: 2,
                desktopUrl: `https://desktop.example.test/?token=${key}`,
              },
            }
          : { error: { message: key } },
      ),
      { status },
    );
  };
  try {
    const result = await checkSamples(samples, async (files) => {
      const module = await import(pathToFileURL(files[0]));
      const t = convexTest(defineSchema({}), {
        "./_generated/server.js": () =>
          import("../../example/convex/_generated/server.js"),
        "./boat-host.ts": async () => module,
      });
      const c = register(t);
      const owner = t.withIdentity({
        subject: "owner",
        tokenIdentifier: "owner-scope",
      });
      const foreign = t.withIdentity({
        subject: "owner",
        tokenIdentifier: "other-issuer-scope",
      });
      const refresh = makeFunctionReference("boat-host:refresh"),
        cached = makeFunctionReference("boat-host:cached");
      await t.mutation(c.registry.ensure, {
        sandbox: { scope: "owner-scope", key: "machine" },
        reference: { provider: "boat", providerId: "owned-vm" },
      });
      const code = (expected) => (error) => error?.data?.code === expected;
      await assert.rejects(
        t.action(refresh, { key: "machine" }),
        code("authentication"),
      );
      await assert.rejects(
        foreign.action(refresh, { key: "machine" }),
        code("authorization"),
      );
      await assert.rejects(
        foreign.query(cached, { key: "machine" }),
        code("authorization"),
      );
      await assert.rejects(
        owner.action(refresh, {
          key: "machine",
          scope: "foreign",
          providerId: "foreign-vm",
        }),
      );
      await assert.rejects(
        owner.action(refresh, { key: "machine" }),
        code("unsupported"),
      );
      assert.equal(
        (await owner.query(cached, { key: "machine" })).reference.providerId,
        "owned-vm",
      );
      assert.equal(calls, 0);
      process.env.BOAT_API_KEY = key;
      const refreshed = await owner.action(refresh, { key: "machine" });
      assert.equal(refreshed.observedState, "running");
      assert.equal(refreshed.resources.cpuCount, 2);
      status = 403;
      const failed = await owner.action(refresh, { key: "machine" });
      assert.equal(failed.refresh.errorCode, "authorization");
      const record = await owner.query(cached, { key: "machine" });
      for (const value of [refreshed, failed, record]) {
        assert.ok(!JSON.stringify(value).includes(key));
        assert.ok(!JSON.stringify(value).includes("https://desktop"));
      }
      assert.equal(calls, 2);
    });
    assert.equal(result.status, 0, result.output);
  } finally {
    globalThis.fetch = nativeFetch;
    delete process.env.BOAT_API_KEY;
    delete process.env.BOAT_ORG;
  }
});

test("every capability mapping has its dated native source and all guide links resolve", async () => {
  const { readFile, access } = await import("node:fs/promises");
  const path = await import("node:path");
  const { capabilityValidator } = await import("@fantastic.dev/convex-sandbox");
  const text = await readFile("docs/boat/guide.md", "utf8");
  for (const capability of capabilityValidator.members.map(
    (member) => member.value,
  )) {
    const row = text
      .split("\n")
      .find((line) => line.startsWith(`| ${capability} |`));
    assert.ok(row, `Missing mapping: ${capability}`);
    assert.match(row.split("|")[3], /2026-11-04: \S/);
  }
  for (const file of [
    "docs/boat/guide.md",
    "docs/boat/setup.md",
    "docs/boat/connections.md",
    "docs/boat/reconciliation.md",
    "docs/boat/conformance.md",
    "docs/boat/webhooks.md",
    "docs/boat/release.md",
    "docs/boat/live-verification.md",
  ]) {
    const contents = await readFile(file, "utf8");
    for (const match of contents.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^https?:\/\//.test(match[1])) continue;
      const target = match[1].split("#")[0];
      if (target) await access(path.resolve(path.dirname(file), target));
    }
  }
  assert.doesNotMatch(text, /linear\.app|VITE_BOAT_API_KEY\s*=/);
});
