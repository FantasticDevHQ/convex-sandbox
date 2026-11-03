export * from "./stores.js";
export * from "./conformance.js";
export * from "./faults.js";
export * from "./simulator.js";
import type { GenericDataModel } from "convex/server";
import type { TestConvexRoot } from "convex-test";
import type { ComponentApi } from "../component/_generated/component.js";
import schema from "../component/schema.js";

export { schema };

/** Register the experimental component in an offline convex-test host. */
export function register(
  host: Pick<TestConvexRoot<GenericDataModel>, "registerComponent">,
  path = "sandbox",
): ComponentApi {
  return host.registerComponent<ComponentApi>(path, schema, {
    "./_generated/server.js": () => import("../component/_generated/server.js"),
    "./images.js": () => import("../component/images.js"),
    "./execution.js": () => import("../component/execution.js"),
    "./lifecycle.js": () => import("../component/lifecycle.js"),
    "./registry.js": () => import("../component/registry.js"),
    "./operations.js": () => import("../component/operations.js"),
    "./observations.js": () => import("../component/observations.js"),
  });
}
