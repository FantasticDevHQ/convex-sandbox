export type WorktreeOwner = {
  id: string;
  root: string;
  deployment: string;
  cloudPort: number;
  directory: string;
};
export type OwnershipIntent = {
  scope: string;
  runId: string;
  operationId: string;
  reservationId: string;
  key: string;
  kind: "create" | "fork";
  accountId: string;
  wallet: string;
  walletTeamId: string | null;
  parent: { key: string; nativeId: string; generation: number } | null;
};
export type OwnershipIndex = {
  version: number;
  owner: Omit<WorktreeOwner, "directory">;
  intents: Array<
    OwnershipIntent & {
      nativeId: string | null;
      generation: number | null;
      outcome: "unknown" | "identified";
    }
  >;
};
export function retainOwnership(
  owner: WorktreeOwner,
  input: OwnershipIntent,
  binding?: { nativeId?: string; generation?: number },
): Promise<OwnershipIndex>;
export function readOwnership(
  directory: string,
  id: string,
): Promise<OwnershipIndex>;
