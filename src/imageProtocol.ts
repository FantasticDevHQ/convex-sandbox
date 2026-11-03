import type {
  ImageOperationKind,
  ImageReference,
  ImageSnapshot,
} from "./images.js";

const object = (raw: unknown): raw is Record<string, unknown> =>
  !!raw && typeof raw === "object" && !Array.isArray(raw);
export function nativeId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 1024 ||
    Array.from(value).some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    ) ||
    /^[a-z][a-z\d+.-]*:\/\//i.test(value)
  )
    throw new Error("Invalid native identifier");
  return value;
}
export function normalizeImage(raw: unknown, provider: string): ImageReference {
  if (
    !object(raw) ||
    raw.provider !== provider ||
    !["template", "disk-snapshot"].includes(String(raw.kind))
  )
    throw new Error("Image provider conflict");
  return {
    provider,
    id: nativeId(raw.id),
    kind: raw.kind as ImageReference["kind"],
  };
}
export function normalizeImageSnapshot(
  raw: unknown,
  kind: ImageOperationKind,
  provider: string,
  jobId?: string,
): ImageSnapshot {
  const invalid = (): never => {
    throw new Error("Invalid native image result");
  };
  if (!object(raw)) return invalid();
  if (raw.state === "failed") return { state: "failed" };
  if (raw.state === "pending") {
    const operationId = nativeId(raw.operationId);
    if (jobId && operationId !== jobId) return invalid();
    return { state: "pending", operationId };
  }
  if (raw.state !== "ready" || !object(raw.result)) return invalid();
  if (kind === "restore" && raw.result.restored === true)
    return { state: "ready", result: { restored: true } };
  if (
    kind === "fork" &&
    object(raw.result.machine) &&
    raw.result.machine.provider === provider
  )
    return {
      state: "ready",
      result: {
        machine: {
          provider,
          providerId: nativeId(raw.result.machine.providerId),
        },
      },
    };
  if (kind === "snapshotDisk" || kind === "createTemplate") {
    const image = normalizeImage(raw.result.image, provider);
    if (image.kind !== (kind === "snapshotDisk" ? "disk-snapshot" : "template"))
      return invalid();
    return { state: "ready", result: { image } };
  }
  return invalid();
}
