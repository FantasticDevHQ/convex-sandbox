/** Test-only bridge transport; binary file values never cross as lossy JSON objects. */
export function encode(value: unknown): unknown {
  if (value instanceof ArrayBuffer)
    return { __workflowBytes: Array.from(new Uint8Array(value)) };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, encode(item)]),
    );
  return value;
}
export function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === "object") {
    if ("__workflowBytes" in value && Array.isArray(value.__workflowBytes))
      return Uint8Array.from(value.__workflowBytes).buffer;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, decode(item)]),
    );
  }
  return value;
}
