// Test-server transform replaces only ConnectedCommands hooks, never the build.
export function useQuery() { return null; }
export function usePaginatedQuery() {
  return { results: [], status: "Exhausted", loadMore: () => {} };
}
export function useAction() {
  return async () => { throw Error("Synthetic expired approval refusal"); };
}
