import { convexTest } from "convex-test";
import {
  defineSchema,
  makeFunctionReference,
  mutationGeneric,
} from "convex/server";
import { v } from "convex/values";
import { expect, test } from "vitest";
import {
  sandboxDescriptionValidator,
  operationHandleValidator,
  executionHandleValidator,
  operationStatusValidator,
  lifecycleResultValidator,
} from "@fantastic.dev/convex-sandbox";

const payload = v.object({
  description: sandboxDescriptionValidator,
  operation: operationHandleValidator,
  execution: executionHandleValidator,
  status: operationStatusValidator,
  lifecycle: lifecycleResultValidator,
});
const modules = {
  "./_generated/server.js": async () => ({ mutation: mutationGeneric }),
  "./contracts.js": async () => ({
    echo: mutationGeneric({
      args: { value: payload },
      returns: payload,
      handler: async (_, { value }) => value,
    }),
  }),
};
const sandbox = { scope: "opaque", key: "logical" };
const reference = { provider: "external", providerId: "physical" };
const value = {
  description: {
    sandbox,
    reference,
    state: "paused",
    resources: { cpuCount: 2, memoryMiB: 4096 },
  },
  operation: { sandbox, operationId: "op" },
  execution: { sandbox, reference, operationId: "op", executionId: "exec" },
  status: "succeeded",
  lifecycle: {
    sandbox,
    reference,
    state: "starting",
    operation: { sandbox, operationId: "lifecycle-op" },
  },
};
const echo = makeFunctionReference<"mutation">("contracts:echo");

test("public contract validators round-trip across an actual Convex function boundary", async () => {
  const t = convexTest(defineSchema({}), modules);
  expect(await t.mutation(echo, { value })).toEqual(value);
});

test.each([
  { ...value, description: { ...value.description, state: "vendor-only" } },
  { ...value, operation: { ...value.operation, callback: "forbidden" } },
  { ...value, execution: { ...value.execution, executionId: 17 } },
  {
    ...value,
    description: { ...value.description, resources: { memoryMiB: "4 GB" } },
  },
])("malformed contract data is rejected at RPC: %j", async (invalid) => {
  const t = convexTest(defineSchema({}), modules);
  await expect(t.mutation(echo, { value: invalid })).rejects.toThrow();
});
