import type { ReactNode } from "react";
import { ClerkProvider, useAuth, useClerk } from "@clerk/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ConvexReactClient, useConvexAuth, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { backendUrl } from "./backend-client";
import {
  OperatorGate,
  OperatorSessionProvider,
  useOperatorSessionLock,
  type OperatorState,
} from "./operator-gate";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? "";
const configured = Boolean(backendUrl && publishableKey.startsWith("pk_test_"));
// Keep authentication and its query cache separate from the public simulator.
const operatorClient =
  configured && backendUrl ? new ConvexReactClient(backendUrl) : null;
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    void operatorClient?.close();
  });

type Session =
  | { state: "authorized"; issuer: string; subject: string; scope: string }
  | { state: "forbidden" | "signedOut" };
const sessionQuery = makeFunctionReference<
  "query",
  Record<string, never>,
  Session
>("live/access:session");

export function OperatorProvider({ children }: { children: ReactNode }) {
  if (!configured)
    return <OperatorSessionProvider>{children}</OperatorSessionProvider>;
  return (
    <ClerkProvider publishableKey={publishableKey}>
      <OperatorSessionProvider>{children}</OperatorSessionProvider>
    </ClerkProvider>
  );
}

function ConnectedAccess({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, userId, sessionId } = useAuth();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const clerk = useClerk();
  const sessionKey = `${sessionId ?? "signedOut"}:${userId ?? "anonymous"}`;
  const { blockedSession } = useOperatorSessionLock();
  const session = useQuery(
    sessionQuery,
    isLoaded &&
      isSignedIn &&
      isAuthenticated &&
      !isLoading &&
      blockedSession !== sessionKey
      ? {}
      : "skip",
  );
  let state: OperatorState = "signedOut";
  if (!isLoaded || isLoading) state = "loading";
  else if (isSignedIn && isAuthenticated) {
    state = !session ? "loading" : session.state;
    // A cached response from a previous identity never authorizes this subtree.
    if (session?.state === "authorized" && session.subject !== userId)
      state = "loading";
  }
  return (
    <OperatorGate
      key={sessionKey}
      sessionKey={sessionKey}
      state={state}
      onSignIn={() => {
        void clerk.openSignIn();
      }}
      onSignOut={async () => {
        await clerk.signOut();
      }}
    >
      {children}
    </OperatorGate>
  );
}

export function OperatorAccess({ children }: { children: ReactNode }) {
  if (!operatorClient)
    return (
      <OperatorGate
        state="unavailable"
        onSignIn={() => {}}
        onSignOut={async () => {}}
      >
        {children}
      </OperatorGate>
    );
  return (
    <ConvexProviderWithClerk client={operatorClient} useAuth={useAuth}>
      <ConnectedAccess>{children}</ConnectedAccess>
    </ConvexProviderWithClerk>
  );
}
