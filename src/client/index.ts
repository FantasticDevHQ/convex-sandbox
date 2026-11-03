export * from "./executionStore.js";
export * from "../execution.js";
export * from "./execution.js";
export * from "./lifecycleStore.js";
export * from "../lifecycle.js";
export * from "./lifecycle.js";
export * from "../state.js";
export * from "../capabilities.js";
export * from "./errors.js";
export * from "../contracts.js";
export * from "./providers.js";
import type { Observation, SandboxIdentity } from "../contracts.js";

/** SDK-specific results are untrusted until projected to the common contract. */
export interface DescribeAdapter {
  describe(providerId: string): Promise<unknown>;
}

/** This callback executes in the host action; it never crosses component RPC. */
export type PersistObservation = (observation: Observation) => Promise<void>;

export class SandboxBoundary {
  readonly #adapters: Map<string, DescribeAdapter>;

  constructor(adapters: Readonly<Record<string, DescribeAdapter>>) {
    this.#adapters = new Map(Object.entries(adapters));
  }

  async observe(
    identity: SandboxIdentity,
    persist: PersistObservation,
  ): Promise<Observation> {
    const adapter = this.#adapters.get(identity.provider);
    if (!adapter) throw new Error("Unknown provider");
    const result = await adapter.describe(identity.providerId);
    if (
      !result ||
      typeof result !== "object" ||
      !("id" in result) ||
      result.id !== identity.providerId ||
      !("state" in result) ||
      (result.state !== "running" && result.state !== "stopped")
    ) {
      throw new Error("Invalid provider observation");
    }
    // Explicit projection: SDK objects may include tokens, methods and headers.
    const observation: Observation = {
      scope: identity.scope,
      key: identity.key,
      provider: identity.provider,
      providerId: identity.providerId,
      state: result.state,
    };
    await persist(observation);
    return observation;
  }
}
