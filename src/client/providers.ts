import { SandboxImages } from "./images.js";
import type { ImageAdapter, ImageStore, ConnectionAdapter } from "../images.js";
import { SandboxFiles } from "./files.js";
import type { FileAdapter, FileStore } from "../files.js";
import { executionPreparer } from "./executionProvider.js";
import { SandboxExecution } from "./execution.js";
import type { ExecutionAdapter, ExecutionStore } from "../execution.js";
import { SandboxLifecycle } from "./lifecycle.js";
import type {
  CreateOptions,
  ProviderCallContext,
  LifecycleStore,
  PrepareLifecycle,
  ProviderObservation,
} from "../lifecycle.js";
import { defineCapabilities, type Capabilities } from "../capabilities.js";
import {
  normalizeProviderError,
  requireCapability,
  SandboxProviderError,
} from "./errors.js";
import type { GenericValidator } from "convex/values";
import { sandboxStateValidator } from "../contracts.js";
import {
  projectNativeLifecycleJob,
  type NativeLifecycleJob,
} from "../lifecycleJobs.js";
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
  /** Accepted lifecycle job identity only; not a credential or arbitrary metadata. */
  lifecycleJob?: NativeLifecycleJob;
}

/** An adapter lives in a trusted host action. Never store or send it over RPC. */
export interface SandboxAdapter {
  images?: ImageAdapter;
  connections?: ConnectionAdapter;
  files?: FileAdapter;
  execution?: ExecutionAdapter;
  describe(
    providerId: string,
    context?: ProviderCallContext,
  ): Promise<ProviderSandbox>;
  create?(
    options: CreateOptions,
    context: ProviderCallContext,
  ): Promise<ProviderSandbox>;
  findCreate?(
    idempotencyKey: string,
    context: ProviderCallContext,
  ): Promise<ProviderSandbox | null>;
  start?(
    providerId: string,
    context: ProviderCallContext,
  ): Promise<ProviderSandbox>;
  resumeMemory?(
    providerId: string,
    context: ProviderCallContext,
  ): Promise<ProviderSandbox>;
  stop?(
    providerId: string,
    context: ProviderCallContext,
  ): Promise<ProviderSandbox>;
  delete?(
    providerId: string,
    context: ProviderCallContext,
  ): Promise<ProviderSandbox>;
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
  createIdempotency?: "native" | "none";
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
  createIdempotency?: "native" | "none";
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
  if (
    registration.capabilities?.supported.includes("create") &&
    (typeof registration.adapter.create !== "function" ||
      !["native", "none"].includes(registration.createIdempotency ?? ""))
  )
    throw new Error(
      "Create requires explicit idempotency support and an implementation",
    );
  if (registration.capabilities?.supported.includes("execute")) {
    const execution = registration.adapter.execution;
    if (
      !execution ||
      !["native", "none"].includes(execution.idempotency) ||
      typeof execution.start !== "function" ||
      typeof execution.status !== "function"
    )
      throw new Error(
        "Execution requires start/status implementations and explicit idempotency support",
      );
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
    operation:
      | "describe"
      | "capabilities"
      | "get"
      | "observe"
      | "start"
      | "resumeMemory"
      | "stop"
      | "delete"
      | "execute"
      | "executionStatus"
      | "executionGet"
      | "executionLogs"
      | "cancelExecution"
      | "readFile"
      | "writeFile"
      | "listFiles"
      | "deleteFile"
      | "transferFile"
      | "listTemplates"
      | "snapshotDisk"
      | "createTemplate"
      | "fork"
      | "restore"
      | "getConnection"
      | "imageStatus"
      | "imageGet";
  }>,
) => Promise<void>;

/** Action-local registry. Authorization runs before provider lookup or execution. */
export class SandboxProviders {
  readonly #adapters = new Map<
    string,
    {
      adapter: SandboxAdapter;
      capabilities: Capabilities;
      createIdempotency: "native" | "none";
    }
  >();
  readonly #authorize: AuthorizeSandbox;
  readonly #authorizeCreate?: (input: {
    sandbox: Readonly<SandboxKey>;
    provider: string;
  }) => Promise<void>;

  constructor({
    authorize,
    authorizeCreate,
  }: {
    authorize: AuthorizeSandbox;
    authorizeCreate?: (input: {
      sandbox: Readonly<SandboxKey>;
      provider: string;
    }) => Promise<void>;
  }) {
    if (typeof authorize !== "function")
      throw new Error("Authorization callback required");
    this.#authorize = authorize;
    this.#authorizeCreate = authorizeCreate;
  }

  register(provider: ProviderRegistration): void {
    // Validate names and namespaces even when a JS caller skips the factory.
    registerProvider({
      name: provider.name,
      adapter: provider.adapter,
      extensions: provider.extensions,
      capabilities: provider.capabilities,
      createIdempotency: provider.createIdempotency,
    });
    if (this.#adapters.has(provider.name))
      throw new Error("Provider already registered");
    this.#adapters.set(provider.name, {
      adapter: provider.adapter,
      createIdempotency: provider.createIdempotency ?? "none",
      capabilities: defineCapabilities(
        provider.capabilities ?? { version: 1, supported: ["describe"] },
      ),
    });
  }

  images(store: ImageStore): SandboxImages {
    return new SandboxImages(
      store,
      (name) => this.#provider(name),
      this.#authorize,
    );
  }

  files(store: FileStore): SandboxFiles {
    return new SandboxFiles(
      store,
      (name) => this.#provider(name),
      this.#authorize,
    );
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
    try {
      const raw: unknown = await provider.adapter.describe(
        request.reference.providerId,
      );
      return projectDescription(request, raw);
    } catch (error) {
      throw normalizeProviderError(error);
    }
  }

  execution(store: ExecutionStore): SandboxExecution {
    return new SandboxExecution(
      store,
      executionPreparer((name) => this.#provider(name), this.#authorize),
    );
  }

  lifecycle(store: LifecycleStore): SandboxLifecycle {
    return new SandboxLifecycle(store, this.#prepareLifecycle);
  }

  readonly #prepareLifecycle: PrepareLifecycle = async (input) => {
    const options = snapshotCreateOptions(input.options);
    const sandbox = Object.freeze({
      scope: input.sandbox.scope,
      key: input.sandbox.key,
    });
    const reference = input.reference
      ? Object.freeze({ ...input.reference })
      : undefined;
    const action = input.action;
    if (action === "create") {
      if (!this.#authorizeCreate)
        throw new SandboxProviderError({
          code: "authorization",
          outcome: "not_started",
          retryable: false,
        });
      await this.#authorizeCreate(
        Object.freeze({ sandbox, provider: input.provider }),
      );
    } else {
      if (!reference || reference.provider !== input.provider)
        throw new Error("Reference conflict");
      await this.#authorize(
        Object.freeze({ sandbox, reference, operation: action }),
      );
    }
    const provider = this.#provider(input.provider);
    if (["start", "stop", "delete", "resumeMemory"].includes(action)) {
      const method =
        action === "start"
          ? provider.adapter.start
          : action === "stop"
            ? provider.adapter.stop
            : action === "delete"
              ? provider.adapter.delete
              : provider.adapter.resumeMemory;
      if (!method)
        throw new SandboxProviderError({
          code: "unsupported",
          capability: action as "start" | "stop" | "delete" | "resumeMemory",
          outcome: "not_started",
          retryable: false,
        });
    }
    if (action === "create" && options.templateId !== undefined)
      requireCapability(provider.capabilities, "createFromTemplate");
    if (action !== "get" && action !== "observe")
      requireCapability(provider.capabilities, action);
    const validate = (raw: unknown): ProviderObservation => {
      let selected = reference;
      if (!selected) {
        if (!raw || typeof raw !== "object")
          throw new SandboxProviderError({
            code: "validation",
            outcome: "unknown",
            retryable: false,
          });
        const id: unknown = Reflect.get(raw, "providerId");
        if (typeof id !== "string" || !id || id.length > 1024)
          throw new SandboxProviderError({
            code: "validation",
            outcome: "unknown",
            retryable: false,
          });
        selected = { provider: input.provider, providerId: id };
      }
      const normalized = projectDescription(
        { sandbox, reference: selected },
        raw,
      );
      let lifecycleJob: NativeLifecycleJob | undefined;
      const job =
        raw && typeof raw === "object"
          ? Reflect.get(raw, "lifecycleJob")
          : undefined;
      if (job !== undefined) {
        try {
          if (
            !["start", "stop", "delete", "resumeMemory", "describe"].includes(
              action,
            )
          )
            throw new Error("Invalid lifecycle action");
          lifecycleJob = projectNativeLifecycleJob(job);
        } catch {
          throw new SandboxProviderError({
            code: "validation",
            outcome: "unknown",
            retryable: false,
          });
        }
      }
      return {
        providerId: normalized.reference.providerId,
        state: normalized.state,
        ...(normalized.resources ? { resources: normalized.resources } : {}),
        ...(lifecycleJob ? { lifecycleJob } : {}),
      };
    };
    const safe = async (
      fn: () => Promise<ProviderSandbox | null>,
      jobId?: string,
    ) => {
      try {
        const raw = await fn();
        const result = raw === null ? null : validate(raw);
        if (jobId !== undefined && result?.lifecycleJob?.id !== jobId) {
          throw new SandboxProviderError({
            code: "validation",
            outcome: "unknown",
            retryable: false,
          });
        }
        return result;
      } catch (error) {
        throw normalizeProviderError(error);
      }
    };
    return {
      idempotency: provider.createIdempotency,
      validate,
      ...(provider.adapter.findCreate
        ? {
            lookup: (context) =>
              safe(
                () =>
                  provider.adapter.findCreate?.(
                    context.idempotencyKey,
                    context,
                  ) ?? Promise.resolve(null),
              ),
          }
        : {}),
      invoke: async (context) => {
        const adapter = provider.adapter;
        const method =
          action === "create"
            ? undefined
            : action === "describe"
              ? adapter.describe
              : action === "start"
                ? adapter.start
                : action === "resumeMemory"
                  ? adapter.resumeMemory
                  : action === "stop"
                    ? adapter.stop
                    : action === "delete"
                      ? adapter.delete
                      : undefined;
        if (action === "create") {
          if (!adapter.create)
            throw new SandboxProviderError({
              code: "unsupported",
              capability: "create",
              outcome: "not_started",
              retryable: false,
            });
          const description = await safe(
            () => adapter.create?.(options, context) ?? Promise.resolve(null),
          );
          if (!description) throw new Error("Invalid provider data");
          return description;
        }
        if (!method || !reference)
          throw new SandboxProviderError({
            code: "unsupported",
            capability:
              action === "get" || action === "observe" ? "describe" : action,
            outcome: "not_started",
            retryable: false,
          });
        const description = await safe(
          () => method.call(adapter, reference.providerId, context),
          context.lifecycleJob?.id,
        );
        if (!description) throw new Error("Invalid provider data");
        return description;
      },
    };
  };

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

function snapshotCreateOptions(
  input: CreateOptions | undefined,
): CreateOptions {
  if (
    input &&
    Object.keys(input).some((key) => !["resources", "templateId"].includes(key))
  )
    throw new Error("Invalid create options");
  const options: CreateOptions = {};
  if (input?.templateId !== undefined) {
    if (
      typeof input.templateId !== "string" ||
      !input.templateId ||
      input.templateId.length > 1024
    )
      throw new Error("Invalid template ID");
    options.templateId = input.templateId;
  }
  if (input?.resources) {
    if (
      Object.keys(input.resources).some(
        (key) => !["cpuCount", "memoryMiB", "diskMiB"].includes(key),
      )
    )
      throw new Error("Invalid resources");
    const resources: MachineResources = {};
    for (const key of ["cpuCount", "memoryMiB", "diskMiB"] as const) {
      const value = input.resources[key];
      if (value !== undefined) {
        if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
          throw new Error("Invalid resources");
        resources[key] = value;
      }
    }
    options.resources = Object.freeze(resources);
  }
  return Object.freeze(options);
}
