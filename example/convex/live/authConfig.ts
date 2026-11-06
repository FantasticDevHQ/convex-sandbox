import type { AuthConfig } from "convex/server";

export function developmentAuthConfig(
  environment: Record<string, string | undefined>,
): AuthConfig {
  let issuer: string | undefined;
  try {
    issuer = environment.CLERK_JWT_ISSUER_DOMAIN;
  } catch (error) {
    // Convex's auth-config env proxy throws on an absent value. Its proxy does
    // not implement own-property checks, so hasOwn would also hide set values.
    if (
      !(error instanceof Error) ||
      !error.message.includes(
        "Environment variable CLERK_JWT_ISSUER_DOMAIN is used in auth config file but its value was not set",
      )
    )
      throw error;
  }
  if (issuer) {
    const url = new URL(issuer);
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".clerk.accounts.dev") ||
      url.origin !== issuer
    )
      throw new Error("Use the exact HTTPS Clerk development issuer origin.");
  }
  return {
    providers: issuer ? [{ domain: issuer, applicationID: "convex" }] : [],
  };
}
