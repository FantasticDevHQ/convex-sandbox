import { expect, test } from "vitest";
import { SandboxBoundary } from "../src/client/index.js";

test("observing an adapter records only the validated serializable observation", async () => {
  const writes: unknown[] = [];
  const adapter = { describe: async (id: string) => ({ id, state: "running", token: "synthetic-private-value" }) };
  const boundary = new SandboxBoundary({ simulated: adapter });
  const result = await boundary.observe({ scope: "fixture-a", key: "machine", provider: "simulated", providerId: "fixture-1" }, async (observation: unknown) => { writes.push(observation); });
  expect(result).toEqual({ scope: "fixture-a", key: "machine", provider: "simulated", providerId: "fixture-1", state: "running" });
  expect(writes).toEqual([result]);
  expect(JSON.stringify(writes)).not.toContain("synthetic-private-value");
});

test("an unregistered provider fails before any adapter call or write", async () => {
  let writes = 0;
  const boundary = new SandboxBoundary({});
  await expect(boundary.observe({ scope: "fixture-a", key: "machine", provider: "missing", providerId: "fixture-1" }, async () => { writes++; })).rejects.toThrow("Unknown provider");
  expect(writes).toBe(0);
});

test("invalid provider observations never cross into persistence", async () => {
  let writes = 0;
  const boundary = new SandboxBoundary({ simulated: { describe: async () => ({ id: "fixture-1", state: "invented" }) } });
  await expect(boundary.observe({ scope: "fixture-a", key: "machine", provider: "simulated", providerId: "fixture-1" }, async () => { writes++; })).rejects.toThrow("Invalid provider observation");
  expect(writes).toBe(0);
});

test("persistence failure is surfaced without repeating the provider call", async () => {
  let calls = 0;
  const boundary = new SandboxBoundary({ simulated: { describe: async (id: string) => { calls++; return { id, state: "stopped" }; } } });
  await expect(boundary.observe({ scope: "fixture-a", key: "machine", provider: "simulated", providerId: "fixture-1" }, async () => { throw new Error("persistence failed"); })).rejects.toThrow("persistence failed");
  expect(calls).toBe(1);
});
