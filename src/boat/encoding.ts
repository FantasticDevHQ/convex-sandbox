import { invalid, type Effect } from "./protocol.js";

/** Canonical, bounded base64 without Node dependencies in Convex V8. */
export function decodeBase64(value: unknown, maxBytes: number, effect: Effect) {
  if (
    typeof value !== "string" ||
    value.length > 4 * Math.ceil(maxBytes / 3) ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    throw invalid(effect);
  const binary = atob(value);
  if (btoa(binary) !== value || binary.length > maxBytes) throw invalid(effect);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
export function encodeBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 4096)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 4096));
  return btoa(binary);
}
