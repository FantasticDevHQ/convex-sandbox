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
  };
