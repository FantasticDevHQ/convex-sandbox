import { useRef, useState } from "react";
import { ConvexError } from "convex/values";

const explanations: Record<string, string> = {
  authorization: "Denied. The local fixture does not allow this operation or path.",
  authentication: "Denied. The local fixture identity is unavailable.",
  unsupported:
    "Unsupported by this simulated profile. Choose a profile with this capability.",
  validation:
    "Invalid input. Use a canonical /workspace path and at most 4 KiB of text.",
  capacity:
    "Another fixture action is running. Retry after it finishes or its 60-second lease expires.",
  stale_resource:
    "This fixture is unavailable. Reset demo data to create a new epoch.",
};
export function useTask() {
  const active = useRef(false);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(
    null,
  );
  async function run(label: string, call: () => Promise<unknown>) {
    if (active.current) return;
    active.current = true;
    setPending(label);
    setNotice(null);
    try {
      await call();
      setNotice({
        error: false,
        text: `${label} finished. Read the recorded state below.`,
      });
    } catch (error) {
      const code =
        error instanceof ConvexError &&
        typeof error.data === "object" &&
        error.data !== null &&
        "code" in error.data
          ? String(error.data.code)
          : "unknown";
      setNotice({
        error: true,
        text:
          explanations[code] ??
          "Request failed or its outcome is uncertain. Inspect recorded state before retrying; reset only when you want a new fixture.",
      });
    } finally {
      active.current = false;
      setPending(null);
    }
  }
  return { pending, notice, run, dismiss: () => setNotice(null) };
}
export type Task = ReturnType<typeof useTask>;
