import type { GenericValidator } from "convex/values";
import { sandboxStateValidator } from "../contracts.js";
import type {
  MachineResources,
  ProviderReference,
  SandboxDescription,
  SandboxKey,
  SandboxState,
} from "../contracts.js";

export interface ProviderSandbox {
  providerId: string;
  state: SandboxState;
  resources?: MachineResources;
}

/** An adapter lives in a trusted host action. Never store or send it over RPC. */
export interface SandboxAdapter {
  describe(providerId: string): Promise<ProviderSandbox>;
}

/** Declaration only. Extension execution requires future capability-gated dispatch. */
export interface ExtensionContract<
  Args extends GenericValidator = GenericValidator,
  Result extends GenericValidator = GenericValidator,
> {
  args: Args;
  returns: Result;
}

export interface ProviderRegistration<Name extends string = string> {
  name: Name;
  adapter: SandboxAdapter;
  extensions?: Readonly<Record<`${Name}.${string}`, ExtensionContract>>;
}

export function registerProvider<
  const Name extends string,
  const Extensions extends Record<string, ExtensionContract> = Record<
    never,
    never
  >,
>(registration: {
  name: Name;
  adapter: SandboxAdapter;
  extensions?: Extensions &
    Record<Exclude<keyof Extensions, `${NoInfer<Name>}.${string}`>, never>;
}) {
  if (!registration.name || registration.name.includes("."))
    throw new Error("Invalid provider name");
  for (const key of Object.keys(registration.extensions ?? {})) {
    const prefix = `${registration.name}.`;
    if (!key.startsWith(prefix) || key.length === prefix.length)
      throw new Error("Invalid extension namespace");
  }
  return registration;
}

export interface DescribeRequest {
  sandbox: SandboxKey;
  reference: ProviderReference;
}

export type AuthorizeSandbox = (
  request: Readonly<{
    sandbox: Readonly<SandboxKey>;
    reference: Readonly<ProviderReference>;
    operation: "describe";
  }>,
) => Promise<void>;

/** Action-local registry. Authorization runs before provider lookup or execution. */
export class SandboxProviders {
  readonly #adapters = new Map<string, SandboxAdapter>();
  readonly #authorize: AuthorizeSandbox;

  constructor({ authorize }: { authorize: AuthorizeSandbox }) {
    if (typeof authorize !== "function")
      throw new Error("Authorization callback required");
    this.#authorize = authorize;
  }

  register(provider: ProviderRegistration): void {
    // Validate names and namespaces even when a JS caller skips the factory.
    registerProvider({
      name: provider.name,
      adapter: provider.adapter,
      extensions: provider.extensions,
    });
    if (this.#adapters.has(provider.name))
      throw new Error("Provider already registered");
    this.#adapters.set(provider.name, provider.adapter);
  }

  async describe({
    sandbox,
    reference,
  }: DescribeRequest): Promise<SandboxDescription> {
    // Snapshot caller-owned input before awaiting authorization to avoid substitution.
    const request = Object.freeze({
      sandbox: Object.freeze({ scope: sandbox.scope, key: sandbox.key }),
      reference: Object.freeze({
        provider: reference.provider,
        providerId: reference.providerId,
      }),
      operation: "describe" as const,
    });
    await this.#authorize(request);
    const adapter = this.#adapters.get(request.reference.provider);
    if (!adapter) throw new Error("Unknown provider");
    const raw: unknown = await adapter.describe(request.reference.providerId);
    return projectDescription(request, raw);
  }
}

function projectDescription(
  request: DescribeRequest,
  raw: unknown,
): SandboxDescription {
  if (!raw || typeof raw !== "object")
    throw new Error("Invalid provider description");
  // SDK objects may use getters. Validate exactly the values we return.
  const providerId: unknown = Reflect.get(raw, "providerId");
  const state: unknown = Reflect.get(raw, "state");
  const resources: unknown = Reflect.get(raw, "resources");
  if (providerId !== request.reference.providerId || !isSandboxState(state))
    throw new Error("Invalid provider description");
  const result: SandboxDescription = {
    sandbox: request.sandbox,
    reference: request.reference,
    state,
  };
  if (resources !== undefined) {
    if (!resources || typeof resources !== "object" || Array.isArray(resources))
      throw new Error("Invalid provider description");
    const projected: MachineResources = {};
    for (const key of ["cpuCount", "memoryMiB", "diskMiB"] as const) {
      if (key in resources) {
        const value = (resources as Record<string, unknown>)[key];
        if (value === undefined) continue;
        if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
          throw new Error("Invalid provider description");
        projected[key] = value;
      }
    }
    result.resources = projected;
  }
  return result;
}

function isSandboxState(value: unknown): value is SandboxState {
  return sandboxStateValidator.members.some((member) => member.value === value);
}
