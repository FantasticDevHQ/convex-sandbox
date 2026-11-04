/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as boatConformanceProof from "../boatConformanceProof.js";
import type * as boatConnectionProof from "../boatConnectionProof.js";
import type * as boatExecutionProof from "../boatExecutionProof.js";
import type * as boatFileProof from "../boatFileProof.js";
import type * as boatImageProof from "../boatImageProof.js";
import type * as boatLifecycleProof from "../boatLifecycleProof.js";
import type * as boatLogProof from "../boatLogProof.js";
import type * as boatProbe from "../boatProbe.js";
import type * as boatReconcileProof from "../boatReconcileProof.js";
import type * as demo from "../demo.js";
import type * as demo_contracts from "../demo/contracts.js";
import type * as demo_service from "../demo/service.js";
import type * as demo_store from "../demo/store.js";
import type * as nativeLifecycleProof from "../nativeLifecycleProof.js";
import type * as proof from "../proof.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  boatConformanceProof: typeof boatConformanceProof;
  boatConnectionProof: typeof boatConnectionProof;
  boatExecutionProof: typeof boatExecutionProof;
  boatFileProof: typeof boatFileProof;
  boatImageProof: typeof boatImageProof;
  boatLifecycleProof: typeof boatLifecycleProof;
  boatLogProof: typeof boatLogProof;
  boatProbe: typeof boatProbe;
  boatReconcileProof: typeof boatReconcileProof;
  demo: typeof demo;
  "demo/contracts": typeof demo_contracts;
  "demo/service": typeof demo_service;
  "demo/store": typeof demo_store;
  nativeLifecycleProof: typeof nativeLifecycleProof;
  proof: typeof proof;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  sandbox: import("@fantastic.dev/convex-sandbox/_generated/component.js").ComponentApi<"sandbox">;
};
