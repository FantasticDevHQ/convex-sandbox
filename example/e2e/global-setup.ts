/** Offline browsers must not inherit provider, hosted auth or deployment credentials. */
export default function globalSetup() {
  for (const name of Object.keys(process.env))
    if (
      /^EXAMPLE_|BOAT|CLERK|SECRET|TOKEN|PASSWORD|PRIVATE_KEY|DEPLOY_KEY|ADMIN_KEY|^CONVEX_|^VITE_CONVEX_URL$/i.test(
        name,
      )
    )
      delete process.env[name];
  process.env.CSB_OFFLINE_SECRET_ENV = "empty";
}
