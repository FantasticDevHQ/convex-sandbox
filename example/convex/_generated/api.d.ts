/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as appIsolationProof from "../appIsolationProof.js";
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
import type * as live_access from "../live/access.js";
import type * as live_allowance from "../live/allowance.js";
import type * as live_allowanceModel from "../live/allowanceModel.js";
import type * as live_authConfig from "../live/authConfig.js";
import type * as live_boatHost from "../live/boatHost.js";
import type * as live_catalog from "../live/catalog.js";
import type * as live_cleanup from "../live/cleanup.js";
import type * as live_cleanupModel from "../live/cleanupModel.js";
import type * as live_commands from "../live/commands.js";
import type * as live_create from "../live/create.js";
import type * as live_delete from "../live/delete.js";
import type * as live_files from "../live/files.js";
import type * as live_fork from "../live/fork.js";
import type * as live_forkModel from "../live/forkModel.js";
import type * as live_lifecycle from "../live/lifecycle.js";
import type * as live_lifecycleModel from "../live/lifecycleModel.js";
import type * as live_logs from "../live/logs.js";
import type * as live_machines from "../live/machines.js";
import type * as live_operator from "../live/operator.js";
import type * as live_ownership from "../live/ownership.js";
import type * as live_ownershipData from "../live/ownershipData.js";
import type * as live_ownershipProvider from "../live/ownershipProvider.js";
import type * as live_recovery from "../live/recovery.js";
import type * as live_setup from "../live/setup.js";
import type * as nativeLifecycleProof from "../nativeLifecycleProof.js";
import type * as ownershipProof from "../ownershipProof.js";
import type * as proof from "../proof.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  appIsolationProof: typeof appIsolationProof;
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
  "live/access": typeof live_access;
  "live/allowance": typeof live_allowance;
  "live/allowanceModel": typeof live_allowanceModel;
  "live/authConfig": typeof live_authConfig;
  "live/boatHost": typeof live_boatHost;
  "live/catalog": typeof live_catalog;
  "live/cleanup": typeof live_cleanup;
  "live/cleanupModel": typeof live_cleanupModel;
  "live/commands": typeof live_commands;
  "live/create": typeof live_create;
  "live/delete": typeof live_delete;
  "live/files": typeof live_files;
  "live/fork": typeof live_fork;
  "live/forkModel": typeof live_forkModel;
  "live/lifecycle": typeof live_lifecycle;
  "live/lifecycleModel": typeof live_lifecycleModel;
  "live/logs": typeof live_logs;
  "live/machines": typeof live_machines;
  "live/operator": typeof live_operator;
  "live/ownership": typeof live_ownership;
  "live/ownershipData": typeof live_ownershipData;
  "live/ownershipProvider": typeof live_ownershipProvider;
  "live/recovery": typeof live_recovery;
  "live/setup": typeof live_setup;
  nativeLifecycleProof: typeof nativeLifecycleProof;
  ownershipProof: typeof ownershipProof;
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
