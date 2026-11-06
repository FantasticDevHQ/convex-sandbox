import type { AuthConfig } from "convex/server";

// No issuer means no authentication providers, preserving key-free local setup.
const issuer = Object.hasOwn(process.env, "CLERK_JWT_ISSUER_DOMAIN")
  ? process.env.CLERK_JWT_ISSUER_DOMAIN
  : undefined;
if (issuer) {
  const url = new URL(issuer);
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".clerk.accounts.dev") ||
    url.origin !== issuer
  )
    throw new Error("Use the exact HTTPS Clerk development issuer origin.");
}
export default {
  providers: issuer ? [{ domain: issuer, applicationID: "convex" }] : [],
} satisfies AuthConfig;
