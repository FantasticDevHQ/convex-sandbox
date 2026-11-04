import { SandboxProviderError } from "../client/errors.js";
import { projectNativeLifecycleJob } from "../lifecycleJobs.js";
import type { ProviderCallContext } from "../lifecycle.js";
import { type createBoatTransport, hasControlCharacters } from "./transport.js";
import { projectBoatObservation } from "./observation.js";
import type { BoatApi } from "@boatdev/sdk";

type Effect = "read" | "write";
const invalid = (effect: Effect) =>
  new SandboxProviderError({
    code: "validation",
    outcome: effect === "write" ? "unknown" : "failed",
    retryable: false,
  });
const object = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
function identity(id: string) {
  if (
    typeof id !== "string" ||
    !id ||
    id.length > 1024 ||
    hasControlCharacters(id)
  )
    throw new SandboxProviderError({
      code: "validation",
      outcome: "not_started",
      retryable: false,
    });
}
async function decode(response: Promise<{ raw: Response }>, effect: Effect) {
  let result: unknown;
  try {
    result = await (await response).raw.json();
  } catch (error) {
    if (error instanceof SyntaxError) throw invalid(effect);
    throw error;
  }
  const record = object(result);
  if (record?.ok !== true) throw invalid(effect);
  return record;
}
function job(raw: unknown, effect: Effect, expectedId?: string) {
  const record = object(raw);
  try {
    const handle = projectNativeLifecycleJob(raw);
    if (expectedId !== undefined && handle.id !== expectedId)
      throw invalid(effect);
    if (typeof record?.status !== "string") throw invalid(effect);
    return { ...handle, status: record.status };
  } catch {
    throw invalid(effect);
  }
}

/** Stateless native API mapping. All durable job ownership stays in the component. */
export function createBoatLifecycle(
  transport: ReturnType<typeof createBoatTransport>,
  ttlSeconds: number,
) {
  async function deletion(
    response: Promise<{ raw: Response }>,
    effect: Effect,
    id: string,
    expectedJob?: string,
  ) {
    const reply = await decode(response, effect);
    const operation = object(reply.operation);
    const handle = job(operation, effect, expectedJob);
    if (operation?.kind !== "sandbox" || operation.targetId !== id)
      throw invalid(effect);
    return {
      providerId: id,
      state:
        handle.status === "completed"
          ? ("deleted" as const)
          : ["pending", "processing", "blocked"].includes(handle.status)
            ? ("stopping" as const)
            : ("unknown" as const),
      lifecycleJob: { id: handle.id },
    };
  }
  async function stopStatus(
    api: BoatApi,
    init: RequestInit,
    id: string,
    raw: unknown,
    effect: Effect,
    expectedJob?: string,
  ) {
    const handle = job(raw, effect, expectedJob);
    if (["completed", "superseded"].includes(handle.status)) {
      // Publish an accepted handle before any further read can fail. A later
      // reconciliation checks the historical job against the current machine.
      if (effect === "write")
        return {
          providerId: id,
          state: "unknown" as const,
          lifecycleJob: { id: handle.id },
        };
      // Historical stops remain readable after resume; observe the current VM.
      const observation = await projectBoatObservation(
        api.get({ sandboxId: id }, init),
        "read",
        id,
      );
      return { ...observation, lifecycleJob: { id: handle.id } };
    }
    return {
      providerId: id,
      state: ["pending", "failing"].includes(handle.status)
        ? ("stopping" as const)
        : ("unknown" as const),
      lifecycleJob: { id: handle.id },
    };
  }
  return {
    async start(id: string, context: ProviderCallContext) {
      identity(id);
      return transport.call("write", context, async (api, init) => {
        const reply = await decode(
          api.resumeRaw(
            { sandboxId: id, resumeRequest: { noEnv: true, ttlSeconds } },
            init,
          ),
          "write",
        );
        if (reply.id !== id) throw invalid("write");
        const observation = reply.sandbox
          ? await projectBoatObservation(Promise.resolve(reply), "write", id)
          : { providerId: id };
        return { ...observation, state: "starting" as const };
      });
    },
    async stop(id: string, context: ProviderCallContext) {
      identity(id);
      return transport.call("write", context, async (api, init) => {
        // Raw JSON retains the top-level stop handle omitted by SDK 1.13's model.
        const reply = await decode(
          api.stopRaw({ sandboxId: id, stopRequest: { force: false } }, init),
          "write",
        );
        if (reply.id !== id) throw invalid("write");
        if (reply.sandbox)
          await projectBoatObservation(Promise.resolve(reply), "write", id);
        const nested = object(reply.sandbox)?.stop;
        if (reply.stop !== undefined && nested !== undefined) {
          const a = job(reply.stop, "write"),
            b = job(nested, "write");
          if (a.id !== b.id || a.status !== b.status) throw invalid("write");
        }
        const native = reply.stop ?? nested;
        return native
          ? stopStatus(api, init, id, native, "write")
          : { providerId: id, state: "stopping" as const };
      });
    },
    async delete(id: string, context: ProviderCallContext) {
      identity(id);
      return transport.call("write", context, (api, init) =>
        deletion(
          api.deleteSandboxRaw(
            { sandboxId: id, xAsciiConfirmDelete: id },
            init,
          ),
          "write",
          id,
        ),
      );
    },
    async describe(id: string, context?: ProviderCallContext) {
      identity(id);
      return transport.call("read", context, async (api, init) => {
        const native = context?.lifecycleJob;
        if (!native)
          return projectBoatObservation(
            api.get({ sandboxId: id }, init),
            "read",
            id,
          );
        if (native.kind === "delete")
          return deletion(
            api.getDeletionOperationRaw({ operationId: native.id }, init),
            "read",
            id,
            native.id,
          );
        if (native.kind === "stop") {
          const reply = await decode(
            api.getStopRaw({ sandboxId: id, stopId: native.id }, init),
            "read",
          );
          if (reply.id !== id) throw invalid("read");
          return stopStatus(api, init, id, reply.stop, "read", native.id);
        }
        throw invalid("read");
      });
    },
  };
}
