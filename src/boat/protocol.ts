import { SandboxProviderError } from "../client/errors.js";
import { hasControlCharacters } from "./transport.js";

export type Effect = "read" | "write";
export const invalid = (effect: Effect) =>
  new SandboxProviderError({
    code: "validation",
    outcome: effect === "write" ? "unknown" : "failed",
    retryable: false,
  });
export const object = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
export function identity(id: string) {
  if (
    typeof id !== "string" ||
    !id ||
    id.length > 1024 ||
    hasControlCharacters(id)
  )
    throw new SandboxProviderError({
      code: "validation",
      outcome: "not_started",
      retryable: false,
    });
}
export async function decode(
  response: Promise<{ raw: Response }>,
  effect: Effect,
) {
  let result: unknown;
  try {
    result = await (await response).raw.json();
  } catch (error) {
    if (error instanceof SyntaxError) throw invalid(effect);
    throw error;
  }
  const record = object(result);
  if (record?.ok !== true) throw invalid(effect);
  return record;
}
