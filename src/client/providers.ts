import { defineCapabilities, type Capabilities } from "../capabilities.js";
import {
  normalizeProviderError,
  requireCapability,
  SandboxProviderError,
} from "./errors.js";
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
  version?: 1;
  args: Args;
  returns: Result;
}

export interface ProviderRegistration<Name extends string = string> {
  name: Name;
  adapter: SandboxAdapter;
  capabilities?: Capabilities;
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
  capabilities?: Capabilities;
  extensions?: Extensions &
    Record<Exclude<keyof Extensions, `${NoInfer<Name>}.${string}`>, never>;
}) {
  if (!registration.name || registration.name.includes("."))
    throw new Error("Invalid provider name");
  if (registration.capabilities !== undefined) {
    const capabilities = defineCapabilities(registration.capabilities);
    if (
      capabilities.nativeFeatures?.some(
        (key) => !key.startsWith(`${registration.name}.`),
      )
    )
      throw new Error("Invalid native feature namespace");
  }
  for (const [key, extension] of Object.entries(
    registration.extensions ?? {},
  )) {
    const prefix = `${registration.name}.`;
    if (!key.startsWith(prefix) || key.length === prefix.length)
      throw new Error("Invalid extension namespace");
    if (
      !extension ||
      typeof extension !== "object" ||
      Object.keys(extension).some(
        (field) => !["version", "args", "returns"].includes(field),
      ) ||
      (extension.version !== undefined && extension.version !== 1) ||
      !isRequiredValidator(extension.args) ||
      !isRequiredValidator(extension.returns)
    )
      throw new Error("Invalid extension contract");
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
    operation: "describe" | "capabilities";
  }>,
) => Promise<void>;

/** Action-local registry. Authorization runs before provider lookup or execution. */
export class SandboxProviders {
  readonly #adapters = new Map<
    string,
    { adapter: SandboxAdapter; capabilities: Capabilities }
  >();
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
      capabilities: provider.capabilities,
    });
    if (this.#adapters.has(provider.name))
      throw new Error("Provider already registered");
    this.#adapters.set(provider.name, {
      adapter: provider.adapter,
      capabilities: defineCapabilities(
        provider.capabilities ?? { version: 1, supported: ["describe"] },
      ),
    });
  }

  async capabilities(input: DescribeRequest): Promise<Capabilities> {
    const request = this.#request(input);
    await this.#authorize(
      Object.freeze({ ...request, operation: "capabilities" as const }),
    );
    return this.#provider(request.reference.provider).capabilities;
  }

  async describe(input: DescribeRequest): Promise<SandboxDescription> {
    const request = this.#request(input);
    await this.#authorize(
      Object.freeze({ ...request, operation: "describe" as const }),
    );
    const provider = this.#provider(request.reference.provider);
    requireCapability(provider.capabilities, "describe");
    let raw: unknown;
    try {
      raw = await provider.adapter.describe(request.reference.providerId);
    } catch (error) {
      throw normalizeProviderError(error);
    }
    return projectDescription(request, raw);
  }

  #request({ sandbox, reference }: DescribeRequest) {
    return Object.freeze({
      sandbox: Object.freeze({ scope: sandbox.scope, key: sandbox.key }),
      reference: Object.freeze({
        provider: reference.provider,
        providerId: reference.providerId,
      }),
    });
  }

  #provider(name: string) {
    const provider = this.#adapters.get(name);
    if (!provider)
      throw new SandboxProviderError({
        code: "unknown_provider",
        outcome: "not_started",
        retryable: false,
      });
    return provider;
  }
}

function projectDescription(
  request: DescribeRequest,
  raw: unknown,
): SandboxDescription {
  if (!raw || typeof raw !== "object")
    throw new SandboxProviderError({
      code: "validation",
      outcome: "failed",
      retryable: false,
    });
  // SDK objects may use getters. Validate exactly the values we return.
  const providerId: unknown = Reflect.get(raw, "providerId");
  const state: unknown = Reflect.get(raw, "state");
  const resources: unknown = Reflect.get(raw, "resources");
  if (providerId !== request.reference.providerId || !isSandboxState(state))
    throw new SandboxProviderError({
      code: "validation",
      outcome: "failed",
      retryable: false,
    });
  const result: SandboxDescription = {
    sandbox: request.sandbox,
    reference: request.reference,
    state,
  };
  if (resources !== undefined) {
    if (!resources || typeof resources !== "object" || Array.isArray(resources))
      throw new SandboxProviderError({
        code: "validation",
        outcome: "failed",
        retryable: false,
      });
    const projected: MachineResources = {};
    for (const key of ["cpuCount", "memoryMiB", "diskMiB"] as const) {
      if (key in resources) {
        const value = (resources as Record<string, unknown>)[key];
        if (value === undefined) continue;
        if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
          throw new SandboxProviderError({
            code: "validation",
            outcome: "failed",
            retryable: false,
          });
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

function isRequiredValidator(value: unknown): value is GenericValidator {
  return (
    !!value &&
    typeof value === "object" &&
    "isConvexValidator" in value &&
    value.isConvexValidator === true &&
    "isOptional" in value &&
    value.isOptional === "required"
  );
}
