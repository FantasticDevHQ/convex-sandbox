/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    lifecycle: {
      claimCreateReconciliation: FunctionReference<
        "mutation",
        "internal",
        { operationId: string; sandbox: { key: string; scope: string } },
        null | {
          createdAt: number;
          errorCode?:
            | "unsupported"
            | "validation"
            | "authentication"
            | "authorization"
            | "quota"
            | "rate_limit"
            | "capacity"
            | "timeout"
            | "stale_resource"
            | "unknown_outcome"
            | "unknown_provider";
          idempotency: "native" | "none";
          key: string;
          leaseUntil: number;
          operationId: string;
          provider: string;
          reference?: { provider: string; providerId: string };
          scope: string;
          status: "running" | "unknown" | "succeeded" | "failed";
          updatedAt: number;
          version: number;
        },
        Name
      >;
      claimOperation: FunctionReference<
        "mutation",
        "internal",
        {
          expectedVersion: number;
          mode: "execute" | "reconcile";
          operationId: string;
          sandbox: { key: string; scope: string };
        },
        null | {
          createdAt: number;
          errorCode?:
            | "unsupported"
            | "validation"
            | "authentication"
            | "authorization"
            | "quota"
            | "rate_limit"
            | "capacity"
            | "timeout"
            | "stale_resource"
            | "unknown_outcome"
            | "unknown_provider";
          executionId?: string;
          generation: number;
          key: string;
          kind:
            | "create"
            | "describe"
            | "start"
            | "stop"
            | "delete"
            | "execute"
            | "readFile"
            | "writeFile"
            | "listFiles"
            | "listTemplates"
            | "createTemplate"
            | "snapshotDisk"
            | "suspendMemory"
            | "resumeMemory"
            | "getConnection";
          leaseUntil?: number;
          observationSequence?: number;
          operationId: string;
          reference: { provider: string; providerId: string };
          scope: string;
          sequence: number;
          status:
            | "pending"
            | "running"
            | "succeeded"
            | "failed"
            | "cancelled"
            | "unknown";
          updatedAt: number;
          version: number;
        },
        Name
      >;
      finishCreate: FunctionReference<
        "mutation",
        "internal",
        {
          expectedVersion: number;
          operationId: string;
          result:
            | {
                description: {
                  providerId: string;
                  resources?: {
                    cpuCount?: number;
                    diskMiB?: number;
                    memoryMiB?: number;
                  };
                  state:
                    | "starting"
                    | "running"
                    | "stopping"
                    | "stopped"
                    | "paused"
                    | "deleted"
                    | "error"
                    | "unknown";
                };
              }
            | {
                errorCode:
                  | "unsupported"
                  | "validation"
                  | "authentication"
                  | "authorization"
                  | "quota"
                  | "rate_limit"
                  | "capacity"
                  | "timeout"
                  | "stale_resource"
                  | "unknown_outcome"
                  | "unknown_provider";
                notStarted: boolean;
              };
          sandbox: { key: string; scope: string };
        },
        boolean,
        Name
      >;
      finishOperation: FunctionReference<
        "mutation",
        "internal",
        {
          expectedVersion: number;
          operationId: string;
          result:
            | {
                description: {
                  providerId: string;
                  resources?: {
                    cpuCount?: number;
                    diskMiB?: number;
                    memoryMiB?: number;
                  };
                  state:
                    | "starting"
                    | "running"
                    | "stopping"
                    | "stopped"
                    | "paused"
                    | "deleted"
                    | "error"
                    | "unknown";
                };
              }
            | {
                errorCode:
                  | "unsupported"
                  | "validation"
                  | "authentication"
                  | "authorization"
                  | "quota"
                  | "rate_limit"
                  | "capacity"
                  | "timeout"
                  | "stale_resource"
                  | "unknown_outcome"
                  | "unknown_provider";
                notStarted: boolean;
              };
          sandbox: { key: string; scope: string };
        },
        boolean,
        Name
      >;
      getProvision: FunctionReference<
        "query",
        "internal",
        { sandbox: { key: string; scope: string } },
        null | {
          createdAt: number;
          errorCode?:
            | "unsupported"
            | "validation"
            | "authentication"
            | "authorization"
            | "quota"
            | "rate_limit"
            | "capacity"
            | "timeout"
            | "stale_resource"
            | "unknown_outcome"
            | "unknown_provider";
          idempotency: "native" | "none";
          key: string;
          leaseUntil: number;
          operationId: string;
          provider: string;
          reference?: { provider: string; providerId: string };
          scope: string;
          status: "running" | "unknown" | "succeeded" | "failed";
          updatedAt: number;
          version: number;
        },
        Name
      >;
      reserveCreate: FunctionReference<
        "mutation",
        "internal",
        {
          idempotency: "native" | "none";
          operationId: string;
          provider: string;
          sandbox: { key: string; scope: string };
        },
        | {
            kind: "bound";
            registry: {
              activeOperationId?: string;
              generation: number;
              key: string;
              observedAt?: number;
              observedSequence: number;
              observedState:
                | "starting"
                | "running"
                | "stopping"
                | "stopped"
                | "paused"
                | "deleted"
                | "error"
                | "unknown";
              reference: { provider: string; providerId: string };
              refresh:
                | { status: "never" }
                | { status: "pending" }
                | { status: "stale" }
                | { status: "fresh" }
                | {
                    errorCode:
                      | "unsupported"
                      | "validation"
                      | "authentication"
                      | "authorization"
                      | "quota"
                      | "rate_limit"
                      | "capacity"
                      | "timeout"
                      | "stale_resource"
                      | "unknown_outcome"
                      | "unknown_provider";
                    status: "failed";
                  };
              refreshSequence: number;
              requestedState?: "running" | "stopped" | "deleted";
              resources?: {
                cpuCount?: number;
                diskMiB?: number;
                memoryMiB?: number;
              };
              scope: string;
              tombstone: boolean;
              updatedAt: number;
              version: number;
            };
          }
        | {
            admitted: boolean;
            kind: "provision";
            provision: {
              createdAt: number;
              errorCode?:
                | "unsupported"
                | "validation"
                | "authentication"
                | "authorization"
                | "quota"
                | "rate_limit"
                | "capacity"
                | "timeout"
                | "stale_resource"
                | "unknown_outcome"
                | "unknown_provider";
              idempotency: "native" | "none";
              key: string;
              leaseUntil: number;
              operationId: string;
              provider: string;
              reference?: { provider: string; providerId: string };
              scope: string;
              status: "running" | "unknown" | "succeeded" | "failed";
              updatedAt: number;
              version: number;
            };
          },
        Name
      >;
    };
    observations: {
      get: FunctionReference<
        "query",
        "internal",
        { key: string; scope: string },
        null | {
          key: string;
          provider: string;
          providerId: string;
          scope: string;
          state: "running" | "stopped";
        },
        Name
      >;
      record: FunctionReference<
        "mutation",
        "internal",
        {
          key: string;
          provider: string;
          providerId: string;
          scope: string;
          state: "running" | "stopped";
        },
        null,
        Name
      >;
    };
    operations: {
      begin: FunctionReference<
        "mutation",
        "internal",
        {
          expectedVersion: number;
          kind:
            | "create"
            | "describe"
            | "start"
            | "stop"
            | "delete"
            | "execute"
            | "readFile"
            | "writeFile"
            | "listFiles"
            | "listTemplates"
            | "createTemplate"
            | "snapshotDisk"
            | "suspendMemory"
            | "resumeMemory"
            | "getConnection";
          operationId: string;
          sandbox: { key: string; scope: string };
        },
        {
          createdAt: number;
          errorCode?:
            | "unsupported"
            | "validation"
            | "authentication"
            | "authorization"
            | "quota"
            | "rate_limit"
            | "capacity"
            | "timeout"
            | "stale_resource"
            | "unknown_outcome"
            | "unknown_provider";
          executionId?: string;
          generation: number;
          key: string;
          kind:
            | "create"
            | "describe"
            | "start"
            | "stop"
            | "delete"
            | "execute"
            | "readFile"
            | "writeFile"
            | "listFiles"
            | "listTemplates"
            | "createTemplate"
            | "snapshotDisk"
            | "suspendMemory"
            | "resumeMemory"
            | "getConnection";
          leaseUntil?: number;
          observationSequence?: number;
          operationId: string;
          reference: { provider: string; providerId: string };
          scope: string;
          sequence: number;
          status:
            | "pending"
            | "running"
            | "succeeded"
            | "failed"
            | "cancelled"
            | "unknown";
          updatedAt: number;
          version: number;
        },
        Name
      >;
      executions: FunctionReference<
        "query",
        "internal",
        {
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          sandbox: { key: string; scope: string };
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            createdAt: number;
            errorCode?:
              | "unsupported"
              | "validation"
              | "authentication"
              | "authorization"
              | "quota"
              | "rate_limit"
              | "capacity"
              | "timeout"
              | "stale_resource"
              | "unknown_outcome"
              | "unknown_provider";
            executionId?: string;
            generation: number;
            key: string;
            kind:
              | "create"
              | "describe"
              | "start"
              | "stop"
              | "delete"
              | "execute"
              | "readFile"
              | "writeFile"
              | "listFiles"
              | "listTemplates"
              | "createTemplate"
              | "snapshotDisk"
              | "suspendMemory"
              | "resumeMemory"
              | "getConnection";
            leaseUntil?: number;
            observationSequence?: number;
            operationId: string;
            reference: { provider: string; providerId: string };
            scope: string;
            sequence: number;
            status:
              | "pending"
              | "running"
              | "succeeded"
              | "failed"
              | "cancelled"
              | "unknown";
            updatedAt: number;
            version: number;
          }>;
        },
        Name
      >;
      get: FunctionReference<
        "query",
        "internal",
        { operationId: string; sandbox: { key: string; scope: string } },
        null | {
          createdAt: number;
          errorCode?:
            | "unsupported"
            | "validation"
            | "authentication"
            | "authorization"
            | "quota"
            | "rate_limit"
            | "capacity"
            | "timeout"
            | "stale_resource"
            | "unknown_outcome"
            | "unknown_provider";
          executionId?: string;
          generation: number;
          key: string;
          kind:
            | "create"
            | "describe"
            | "start"
            | "stop"
            | "delete"
            | "execute"
            | "readFile"
            | "writeFile"
            | "listFiles"
            | "listTemplates"
            | "createTemplate"
            | "snapshotDisk"
            | "suspendMemory"
            | "resumeMemory"
            | "getConnection";
          leaseUntil?: number;
          observationSequence?: number;
          operationId: string;
          reference: { provider: string; providerId: string };
          scope: string;
          sequence: number;
          status:
            | "pending"
            | "running"
            | "succeeded"
            | "failed"
            | "cancelled"
            | "unknown";
          updatedAt: number;
          version: number;
        },
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        {
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          sandbox: { key: string; scope: string };
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            createdAt: number;
            errorCode?:
              | "unsupported"
              | "validation"
              | "authentication"
              | "authorization"
              | "quota"
              | "rate_limit"
              | "capacity"
              | "timeout"
              | "stale_resource"
              | "unknown_outcome"
              | "unknown_provider";
            executionId?: string;
            generation: number;
            key: string;
            kind:
              | "create"
              | "describe"
              | "start"
              | "stop"
              | "delete"
              | "execute"
              | "readFile"
              | "writeFile"
              | "listFiles"
              | "listTemplates"
              | "createTemplate"
              | "snapshotDisk"
              | "suspendMemory"
              | "resumeMemory"
              | "getConnection";
            leaseUntil?: number;
            observationSequence?: number;
            operationId: string;
            reference: { provider: string; providerId: string };
            scope: string;
            sequence: number;
            status:
              | "pending"
              | "running"
              | "succeeded"
              | "failed"
              | "cancelled"
              | "unknown";
            updatedAt: number;
            version: number;
          }>;
        },
        Name
      >;
      transition: FunctionReference<
        "mutation",
        "internal",
        {
          errorCode?:
            | "unsupported"
            | "validation"
            | "authentication"
            | "authorization"
            | "quota"
            | "rate_limit"
            | "capacity"
            | "timeout"
            | "stale_resource"
            | "unknown_outcome"
            | "unknown_provider";
          executionId?: string;
          expectedVersion: number;
          operationId: string;
          sandbox: { key: string; scope: string };
          status:
            | "pending"
            | "running"
            | "succeeded"
            | "failed"
            | "cancelled"
            | "unknown";
        },
        boolean,
        Name
      >;
    };
    registry: {
      beginRefresh: FunctionReference<
        "mutation",
        "internal",
        { sandbox: { key: string; scope: string } },
        { generation: number; sequence: number },
        Name
      >;
      ensure: FunctionReference<
        "mutation",
        "internal",
        {
          reference: { provider: string; providerId: string };
          sandbox: { key: string; scope: string };
        },
        {
          activeOperationId?: string;
          generation: number;
          key: string;
          observedAt?: number;
          observedSequence: number;
          observedState:
            | "starting"
            | "running"
            | "stopping"
            | "stopped"
            | "paused"
            | "deleted"
            | "error"
            | "unknown";
          reference: { provider: string; providerId: string };
          refresh:
            | { status: "never" }
            | { status: "pending" }
            | { status: "stale" }
            | { status: "fresh" }
            | {
                errorCode:
                  | "unsupported"
                  | "validation"
                  | "authentication"
                  | "authorization"
                  | "quota"
                  | "rate_limit"
                  | "capacity"
                  | "timeout"
                  | "stale_resource"
                  | "unknown_outcome"
                  | "unknown_provider";
                status: "failed";
              };
          refreshSequence: number;
          requestedState?: "running" | "stopped" | "deleted";
          resources?: {
            cpuCount?: number;
            diskMiB?: number;
            memoryMiB?: number;
          };
          scope: string;
          tombstone: boolean;
          updatedAt: number;
          version: number;
        },
        Name
      >;
      finishRefresh: FunctionReference<
        "mutation",
        "internal",
        {
          generation: number;
          result:
            | {
                resources?: {
                  cpuCount?: number;
                  diskMiB?: number;
                  memoryMiB?: number;
                };
                state:
                  | "starting"
                  | "running"
                  | "stopping"
                  | "stopped"
                  | "paused"
                  | "deleted"
                  | "error"
                  | "unknown";
              }
            | {
                errorCode:
                  | "unsupported"
                  | "validation"
                  | "authentication"
                  | "authorization"
                  | "quota"
                  | "rate_limit"
                  | "capacity"
                  | "timeout"
                  | "stale_resource"
                  | "unknown_outcome"
                  | "unknown_provider";
              };
          sandbox: { key: string; scope: string };
          sequence: number;
        },
        boolean,
        Name
      >;
      get: FunctionReference<
        "query",
        "internal",
        { sandbox: { key: string; scope: string } },
        null | {
          activeOperationId?: string;
          generation: number;
          key: string;
          observedAt?: number;
          observedSequence: number;
          observedState:
            | "starting"
            | "running"
            | "stopping"
            | "stopped"
            | "paused"
            | "deleted"
            | "error"
            | "unknown";
          reference: { provider: string; providerId: string };
          refresh:
            | { status: "never" }
            | { status: "pending" }
            | { status: "stale" }
            | { status: "fresh" }
            | {
                errorCode:
                  | "unsupported"
                  | "validation"
                  | "authentication"
                  | "authorization"
                  | "quota"
                  | "rate_limit"
                  | "capacity"
                  | "timeout"
                  | "stale_resource"
                  | "unknown_outcome"
                  | "unknown_provider";
                status: "failed";
              };
          refreshSequence: number;
          requestedState?: "running" | "stopped" | "deleted";
          resources?: {
            cpuCount?: number;
            diskMiB?: number;
            memoryMiB?: number;
          };
          scope: string;
          tombstone: boolean;
          updatedAt: number;
          version: number;
        },
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        {
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          scope: string;
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            activeOperationId?: string;
            generation: number;
            key: string;
            observedAt?: number;
            observedSequence: number;
            observedState:
              | "starting"
              | "running"
              | "stopping"
              | "stopped"
              | "paused"
              | "deleted"
              | "error"
              | "unknown";
            reference: { provider: string; providerId: string };
            refresh:
              | { status: "never" }
              | { status: "pending" }
              | { status: "stale" }
              | { status: "fresh" }
              | {
                  errorCode:
                    | "unsupported"
                    | "validation"
                    | "authentication"
                    | "authorization"
                    | "quota"
                    | "rate_limit"
                    | "capacity"
                    | "timeout"
                    | "stale_resource"
                    | "unknown_outcome"
                    | "unknown_provider";
                  status: "failed";
                };
            refreshSequence: number;
            requestedState?: "running" | "stopped" | "deleted";
            resources?: {
              cpuCount?: number;
              diskMiB?: number;
              memoryMiB?: number;
            };
            scope: string;
            tombstone: boolean;
            updatedAt: number;
            version: number;
          }>;
        },
        Name
      >;
      rebind: FunctionReference<
        "mutation",
        "internal",
        {
          expectedVersion: number;
          reference: { provider: string; providerId: string };
          sandbox: { key: string; scope: string };
        },
        {
          activeOperationId?: string;
          generation: number;
          key: string;
          observedAt?: number;
          observedSequence: number;
          observedState:
            | "starting"
            | "running"
            | "stopping"
            | "stopped"
            | "paused"
            | "deleted"
            | "error"
            | "unknown";
          reference: { provider: string; providerId: string };
          refresh:
            | { status: "never" }
            | { status: "pending" }
            | { status: "stale" }
            | { status: "fresh" }
            | {
                errorCode:
                  | "unsupported"
                  | "validation"
                  | "authentication"
                  | "authorization"
                  | "quota"
                  | "rate_limit"
                  | "capacity"
                  | "timeout"
                  | "stale_resource"
                  | "unknown_outcome"
                  | "unknown_provider";
                status: "failed";
              };
          refreshSequence: number;
          requestedState?: "running" | "stopped" | "deleted";
          resources?: {
            cpuCount?: number;
            diskMiB?: number;
            memoryMiB?: number;
          };
          scope: string;
          tombstone: boolean;
          updatedAt: number;
          version: number;
        },
        Name
      >;
    };
  };
