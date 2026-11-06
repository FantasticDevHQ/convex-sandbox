import {
  type ReactNode,
  createContext,
  useContext,
  useMemo,
  useState,
} from "react";

const SessionLock = createContext<{
  blockedSession: string | null;
  block: (session: string) => void;
} | null>(null);
export function OperatorSessionProvider({ children }: { children: ReactNode }) {
  const [blockedSession, block] = useState<string | null>(null);
  const value = useMemo(() => ({ blockedSession, block }), [blockedSession]);
  return <SessionLock.Provider value={value}>{children}</SessionLock.Provider>;
}
export function useOperatorSessionLock() {
  const value = useContext(SessionLock);
  if (!value) throw new Error("Missing operator session boundary");
  return value;
}

export type OperatorState =
  "unavailable" | "loading" | "signedOut" | "forbidden" | "authorized";

/** Hides and unmounts all private descendants before waiting for sign-out. */
export function OperatorGate({
  children,
  state,
  onSignIn,
  onSignOut,
  sessionKey = "operator",
}: {
  children: ReactNode;
  state: OperatorState;
  onSignIn: () => void;
  onSignOut: () => Promise<void>;
  sessionKey?: string;
}) {
  const { blockedSession, block } = useOperatorSessionLock();
  const locked = blockedSession === sessionKey;
  const [failure, setFailure] = useState(false);
  async function signOut() {
    block(sessionKey);
    setFailure(false);
    try {
      await onSignOut();
    } catch {
      setFailure(true);
    }
  }
  if (state === "authorized" && !locked)
    return (
      <>
        <div className="operator-session">
          <span>Verified operator · server policy applied</span>
          <button type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
        {children}
      </>
    );
  return (
    <section className="operator-access" aria-labelledby="operator-title">
      <p className="eyebrow">TRUSTED ACCESS / REQUIRED</p>
      <h2 id="operator-title">Operator access</h2>
      <p className="access-lock">Live actions are locked.</p>
      {failure && (
        <p role="alert">
          Sign-out could not finish. Private views remain hidden. Retry sign-out
          to close the identity-provider session.
        </p>
      )}
      {state === "unavailable" ? (
        <>
          <p>
            Connect a managed local backend and configure a Clerk development
            instance to sign in. The simulator is available without credentials.
          </p>
          <p>
            Hosted Convex configuration must first verify the FantasticDev team
            slug/ID, existing project and selected deployment.
          </p>
        </>
      ) : state === "loading" ? (
        <p role="status">Verifying your session with Convex…</p>
      ) : state === "forbidden" && !locked ? (
        <p>
          Your identity is verified, but the server has not granted operator
          access. No private machine data is available.
        </p>
      ) : (
        <p>
          Sign in with the configured identity provider before viewing private
          machines. Signing in does not approve a live run.
        </p>
      )}
      <div className="button-row">
        {state === "signedOut" && !locked && (
          <button type="button" onClick={onSignIn}>
            Sign in
          </button>
        )}
        {(state === "forbidden" || failure || locked) && (
          <button type="button" onClick={() => void signOut()}>
            Retry sign out
          </button>
        )}
        <a className="primary-link" href="/playground">
          Explore simulator ↗
        </a>
      </div>
      <div className="operator-policy">
        <h3>Server-owned operator policy</h3>
        <p>
          Convex verifies the identity. The host resolves issuer, subject and
          tenant scope on the server. Demo profiles cannot grant live access.
        </p>
        <p>
          Provider credentials stay on the server. No live run is approved by
          signing in.
        </p>
      </div>
    </section>
  );
}
