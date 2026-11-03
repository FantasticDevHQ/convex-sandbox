import type { AuthorizeSandbox } from "../client/providers.js";
import type { SandboxKey, ProviderReference } from "../contracts.js";
import type { RegistryRecord } from "../state.js";
import type { FilePathPolicy } from "../files.js";
import { capabilityValidator } from "../capabilities.js";
import { filePath, fileCursor } from "../client/fileProtocol.js";
import { hostError, safeHostCall } from "./errors.js";

export interface HostPrincipal {
  subject: string;
  scope: string;
}
export type HostOperation =
  Parameters<AuthorizeSandbox>[0]["operation"] | "list" | "create";
export interface HostPermission {
  principal: Readonly<HostPrincipal>;
  sandbox: Readonly<SandboxKey>;
  reference?: Readonly<ProviderReference>;
  operation: HostOperation;
}
export interface HostAccessOptions {
  authenticate(): Promise<HostPrincipal | null>;
  getSandbox(sandbox: SandboxKey): Promise<RegistryRecord | null>;
  listSandboxes?(
    scope: string,
    page: { cursor: string | null; limit: number },
  ): Promise<{
    page: RegistryRecord[];
    isDone: boolean;
    continueCursor: string;
  }>;
  authorize(input: Readonly<HostPermission>): boolean | Promise<boolean>;
  selectProvider?(
    principal: Readonly<HostPrincipal>,
    key: string,
  ): string | Promise<string>;
  authorizePath?(
    input: Parameters<FilePathPolicy>[0] & {
      principal: Readonly<HostPrincipal>;
    },
  ): boolean | Promise<boolean>;
}
const text = (value: unknown, max = 1024): string => {
  if (typeof value !== "string" || !value || value.length > max)
    return hostError("validation");
  return value;
};
function request(raw: unknown, fields: string[]): Record<string, unknown> {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    Object.keys(raw).some((key) => !fields.includes(key))
  )
    return hostError("validation");
  return raw as Record<string, unknown>;
}
function operation(raw: HostOperation): HostOperation {
  if (
    ![
      ...capabilityValidator.members.map((member) => member.value),
      "list",
      "get",
      "observe",
      "capabilities",
      "executionStatus",
      "executionGet",
      "imageGet",
      "imageStatus",
    ].includes(raw)
  )
    return hostError("validation");
  return raw;
}
function project(row: RegistryRecord): RegistryRecord {
  return {
    scope: row.scope,
    key: row.key,
    reference: {
      provider: row.reference.provider,
      providerId: row.reference.providerId,
    },
    generation: row.generation,
    version: row.version,
    observedState: row.observedState,
    tombstone: row.tombstone,
    refreshSequence: row.refreshSequence,
    observedSequence: row.observedSequence,
    refresh:
      row.refresh.status === "failed"
        ? { status: "failed", errorCode: row.refresh.errorCode }
        : { status: row.refresh.status },
    updatedAt: row.updatedAt,
    ...(row.requestedState === undefined
      ? {}
      : { requestedState: row.requestedState }),
    ...(row.observedAt === undefined ? {} : { observedAt: row.observedAt }),
    ...(row.activeOperationId === undefined
      ? {}
      : { activeOperationId: row.activeOperationId }),
    ...(row.resources === undefined
      ? {}
      : {
          resources: {
            ...(row.resources.cpuCount === undefined
              ? {}
              : { cpuCount: row.resources.cpuCount }),
            ...(row.resources.memoryMiB === undefined
              ? {}
              : { memoryMiB: row.resources.memoryMiB }),
            ...(row.resources.diskMiB === undefined
              ? {}
              : { diskMiB: row.resources.diskMiB }),
          },
        }),
  };
}

/** Composable request boundary. All callbacks are trusted server configuration. */
export function createHostAccess(options: HostAccessOptions) {
  async function principal(): Promise<Readonly<HostPrincipal>> {
    try {
      const found = await options.authenticate();
      if (!found) return hostError("authentication");
      return Object.freeze({
        subject: text(found.subject),
        scope: text(found.scope),
      });
    } catch {
      return hostError("authentication");
    }
  }
  async function allowed(input: HostPermission) {
    try {
      return (await options.authorize(Object.freeze(input))) === true;
    } catch {
      return false;
    }
  }
  async function check(
    identity: Readonly<HostPrincipal>,
    sandbox: Readonly<SandboxKey>,
    op: HostOperation,
    reference?: Readonly<ProviderReference>,
  ) {
    if (sandbox.scope !== identity.scope) return hostError("authorization");
    const row = await options.getSandbox(sandbox);
    if (
      !row ||
      row.scope !== identity.scope ||
      row.key !== sandbox.key ||
      (row.tombstone &&
        !["get", "executionGet", "imageGet", "list"].includes(op)) ||
      (reference &&
        (reference.provider !== row.reference.provider ||
          reference.providerId !== row.reference.providerId))
    )
      return hostError("authorization");
    const selected = Object.freeze({
      provider: row.reference.provider,
      providerId: row.reference.providerId,
    });
    if (
      !(await allowed({
        principal: identity,
        sandbox,
        reference: selected,
        operation: op,
      }))
    )
      return hostError("authorization");
    return row;
  }
  async function resolve(raw: unknown, op: HostOperation) {
    const input = request(raw, ["key"]),
      key = text(input.key);
    operation(op);
    const identity = await principal(),
      sandbox = Object.freeze({ scope: identity.scope, key });
    const row = await check(identity, sandbox, op);
    return {
      sandbox,
      reference: Object.freeze({
        provider: row.reference.provider,
        providerId: row.reference.providerId,
      }),
      row,
    };
  }
  async function create(raw: unknown) {
    const input = request(raw, ["key"]),
      key = text(input.key),
      identity = await principal();
    if (!options.selectProvider) return hostError("authorization");
    const provider = text(await options.selectProvider(identity, key), 256),
      sandbox = Object.freeze({ scope: identity.scope, key });
    if (!(await allowed({ principal: identity, sandbox, operation: "create" })))
      return hostError("authorization");
    return { sandbox, provider };
  }
  const authorize: AuthorizeSandbox = async (input) =>
    safeHostCall(async () => {
      const sandbox = Object.freeze({
          scope: text(input.sandbox.scope),
          key: text(input.sandbox.key),
        }),
        reference = Object.freeze({
          provider: text(input.reference.provider, 256),
          providerId: text(input.reference.providerId),
        }),
        op = operation(input.operation);
      await check(await principal(), sandbox, op, reference);
    });
  return Object.freeze({
    authorize,
    authorizeCreate: async (input: {
      sandbox: Readonly<SandboxKey>;
      provider: string;
    }) =>
      safeHostCall(async () => {
        const sandbox = {
            scope: text(input.sandbox.scope),
            key: text(input.sandbox.key),
          },
          provider = text(input.provider, 256);
        const identity = await principal();
        if (identity.scope !== sandbox.scope) return hostError("authorization");
        const selected = await create({ key: sandbox.key });
        if (
          selected.sandbox.scope !== sandbox.scope ||
          selected.provider !== provider
        )
          return hostError("authorization");
      }),
    resolve: (raw: unknown, op: HostOperation) =>
      safeHostCall(async () => {
        const { sandbox, reference } = await resolve(raw, op);
        return { sandbox, reference };
      }),
    get: (raw: unknown) =>
      safeHostCall(async () => project((await resolve(raw, "get")).row)),
    create: (raw: unknown) => safeHostCall(() => create(raw)),
    list: (raw: unknown) =>
      safeHostCall(async () => {
        const input = request(raw, ["cursor", "limit"]),
          limit = input.limit ?? 50;
        if (
          typeof limit !== "number" ||
          !Number.isSafeInteger(limit) ||
          limit < 1 ||
          limit > 100
        )
          return hostError("validation");
        let cursor: string | null;
        try {
          cursor = fileCursor(
            input.cursor === undefined ? null : (input.cursor as string | null),
          );
        } catch {
          return hostError("validation");
        }
        const identity = await principal();
        if (!options.listSandboxes) return hostError("unsupported");
        const rawPage = await options.listSandboxes(identity.scope, {
          cursor,
          limit,
        });
        const page: RegistryRecord[] = [];
        let partial = rawPage.page.length > limit;
        for (const row of rawPage.page.slice(0, limit)) {
          if (row.scope !== identity.scope) return hostError("authorization");
          if (
            !(await allowed({
              principal: identity,
              sandbox: Object.freeze({ scope: identity.scope, key: row.key }),
              reference: Object.freeze({ ...row.reference }),
              operation: "list",
            }))
          ) {
            partial = true;
            continue;
          }
          page.push(project(row));
        }
        return {
          page,
          isDone: rawPage.isDone,
          continueCursor: rawPage.continueCursor,
          partial,
        };
      }),
    authorizePath: (async (input) =>
      safeHostCall(async () => {
        let path: string;
        try {
          path = filePath(input.path);
        } catch {
          return hostError("validation");
        }
        const sandbox = Object.freeze({
            scope: text(input.sandbox.scope),
            key: text(input.sandbox.key),
          }),
          reference = Object.freeze({
            provider: text(input.reference.provider, 256),
            providerId: text(input.reference.providerId),
          }),
          op = operation(input.operation),
          identity = await principal();
        if (
          ![
            "readFile",
            "writeFile",
            "listFiles",
            "deleteFile",
            "transferFile",
          ].includes(op)
        )
          return hostError("validation");
        await check(identity, sandbox, op, reference);
        if (!options.authorizePath) return false;
        try {
          return (
            (await options.authorizePath(
              Object.freeze({
                ...input,
                sandbox,
                reference,
                path,
                principal: identity,
              }),
            )) === true
          );
        } catch {
          return false;
        }
      })) satisfies FilePathPolicy,
  });
}
