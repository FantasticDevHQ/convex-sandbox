import { type Infer, v } from "convex/values";

/** Opaque nonsecret provider job ID. No URLs, SDK objects or provider payloads. */
export const nativeLifecycleJobValidator = v.object({ id: v.string() });
export type NativeLifecycleJob = Infer<typeof nativeLifecycleJobValidator>;

/** Explicit projection keeps provider extras out of shared operation records. */
export function projectNativeLifecycleJob(raw: unknown): NativeLifecycleJob {
  const id =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? Reflect.get(raw, "id")
      : undefined;
  if (
    typeof id !== "string" ||
    !id ||
    id.length > 1024 ||
    id.includes("://") ||
    id.includes("?") ||
    id.includes("#")
  )
    throw new Error("Invalid native lifecycle job");
  return { id };
}
