import { SandboxProviderError } from "../client/errors.js";
import { nativeId } from "../imageProtocol.js";
import type { ImageAdapter, TemplatePage } from "../images.js";
import { nativeCreateKey } from "./provision.js";
import { decode, invalid, object, type Effect } from "./protocol.js";
import { projectBoatObservation } from "./observation.js";
import type { createBoatTransport } from "./transport.js";

function id(value: unknown, effect: Effect) {
  try {
    return nativeId(value);
  } catch {
    throw invalid(effect);
  }
}
function forkJob(source: string, child: string, effect: Effect) {
  if (source === child) throw invalid(effect);
  return id(JSON.stringify(["boat-fork-v1", source, child]), effect);
}
function childId(source: string, job: string) {
  try {
    const value: unknown = JSON.parse(id(job, "read"));
    if (
      !Array.isArray(value) ||
      value.length !== 3 ||
      value[0] !== "boat-fork-v1" ||
      value[1] !== source
    )
      throw invalid("read");
    const child = id(value[2], "read");
    if (forkJob(source, child, "read") !== job) throw invalid("read");
    return child;
  } catch {
    throw invalid("read");
  }
}

/** Native fork jobs and a source-scoped view of mutable saved snapshot names. */
export function createBoatImages(
  transport: ReturnType<typeof createBoatTransport>,
  ttlSeconds: number,
): ImageAdapter {
  return {
    async fork(providerId, context) {
      const source = id(providerId, "write");
      const idempotencyKey = await nativeCreateKey(
        JSON.stringify(["boat-fork-v1", source, context.idempotencyKey]),
      );
      return transport.call("write", context, async (api, init) => {
        const reply = await decode(
          api.forkRaw(
            {
              sandboxId: source,
              idempotencyKey,
              forkRequest: { noEnv: true, env: {}, ttlSeconds },
            },
            init,
          ),
          "write",
        );
        const child = id(reply.id, "write");
        if (reply.sandbox !== undefined)
          await projectBoatObservation(Promise.resolve(reply), "write", child);
        // Publish the new physical identity before any readiness read can fail.
        return {
          state: "pending",
          operationId: forkJob(source, child, "write"),
          acceptedMachine: { provider: "boat", providerId: child },
        };
      });
    },
    async status(providerId, operationId, context) {
      const source = id(providerId, "read"),
        child = childId(source, operationId);
      return transport.call("read", context, async (api, init) => {
        const observation = await projectBoatObservation(
          api.get({ sandboxId: child }, init),
          "read",
          child,
        );
        if (observation.state === "running")
          return {
            state: "ready",
            result: { machine: { provider: "boat", providerId: child } },
          };
        if (observation.state === "error") return { state: "failed" };
        if (observation.state === "starting")
          return { state: "pending", operationId };
        // Missing, stopped or future native states cannot establish fork readiness.
        throw invalid("read");
      });
    },
    async listTemplates(providerId, page, context) {
      const source = id(providerId, "read");
      if (page.cursor !== null)
        throw new SandboxProviderError({
          code: "unsupported",
          capability: "listTemplates",
          outcome: "not_started",
          retryable: false,
        });
      const { limit } = page;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        throw invalid("read");
      return transport.call("read", context, async (api, init) => {
        const reply = await decode(api.listSavedSnapshotsRaw(init), "read");
        if (!Array.isArray(reply.snapshots) || reply.snapshots.length > 10000)
          throw invalid("read");
        const items: TemplatePage["items"] = [];
        const names = new Set<string>();
        let count = 0;
        for (const raw of reply.snapshots) {
          const snapshot = object(raw);
          // Never expose another source's names/artifacts through this binding.
          if (snapshot?.sourceSandboxId !== source) continue;
          if (
            typeof snapshot.name !== "string" ||
            !/^[a-z0-9][a-z0-9-]{0,62}$/.test(snapshot.name) ||
            names.has(snapshot.name) ||
            typeof snapshot.status !== "string"
          )
            throw invalid("read");
          names.add(snapshot.name);
          count++;
          if (items.length >= limit) continue;
          let readiness: TemplatePage["items"][number]["readiness"] =
            snapshot.status === "saving"
              ? "pending"
              : snapshot.status === "failed"
                ? "failed"
                : "unknown";
          if (snapshot.status === "ready") {
            try {
              id(snapshot.snapshotId, "read");
              readiness = "ready";
            } catch {
              /* A name without a ready artifact is not deployable. */
            }
          }
          items.push({
            reference: {
              provider: "boat",
              id: snapshot.name,
              kind: "template",
            },
            readiness,
          });
        }
        return { items, nextCursor: null, complete: count <= limit };
      });
    },
    // Mutable names have no immutable save-generation/job ID while saving.
    // No capture, in-place restore or create-from-template semantics are invented.
  };
}
