export type BoatMachineType = "small" | "default" | "large" | "xlarge";

export interface BoatOptions {
  /** Read from trusted server configuration, never browser input. */
  apiKey: string;
  /** Explicit wallet scope, default personal. Never changes the active wallet. */
  org?: string;
  /** Host-owned fetch implementation. It must not replay mutations or log keys. */
  fetch?: typeof fetch;
  /** Native machine class for new machines, default small. */
  machineType?: BoatMachineType;
  /** Auto-stop deadline after create, default 3600; 1 through 2592000 seconds. */
  ttlSeconds?: number;
}
