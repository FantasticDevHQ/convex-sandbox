import type { CreationView } from "../../convex/live/create";
// Test-server transform replaces only the connected creation component's hooks.
// This module is never imported by the production app build.
export function useQuery(
  _reference: unknown,
  args: { key: string } | "skip",
): CreationView | undefined {
  if (args === "skip") return undefined;
  return {
    key: args.key,
    operationId: `create-${args.key}`,
    reservationHeld: false,
    reservationAt: null,
    reservationUnknown: false,
    registry: null,
    provision: null,
  };
}
export function useAction(_reference: unknown) {
  return async (_args: { key: string }) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    throw Error("Synthetic expired approval refusal");
  };
}
