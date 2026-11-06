import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "../schema";

const checkAccess = makeFunctionReference<"action">("live/access:checkAccess");
const session = makeFunctionReference<"query">("live/access:session");
const issuer = "https://synthetic.clerk.accounts.dev";
const grant = { issuer, subject: "operator", scope: "example:operator" };
const fixture = () =>
  convexTest(schema, {
    "./_generated/server.js": () => import("../_generated/server.js"),
    "./live/access.ts": () => import("./access"),
  });
beforeEach(() =>
  vi.stubEnv("EXAMPLE_OPERATOR_GRANTS", JSON.stringify([grant])),
);
afterEach(() => vi.unstubAllEnvs());

test("anonymous action", async () => {
  await expect(fixture().action(checkAccess, {})).rejects.toMatchObject({
    data: { code: "authentication" },
  });
});
test("foreign operator", async () => {
  const t = fixture();
  for (const identity of [
    { issuer, subject: "foreign" },
    { issuer: "https://foreign.example.test", subject: "operator" },
  ]) {
    await expect(
      t.withIdentity(identity).action(checkAccess, {}),
    ).rejects.toMatchObject({ data: { code: "authorization" } });
  }
});
test("verified grant resolves only server-owned scope", async () => {
  const t = fixture().withIdentity({ issuer, subject: "operator" });
  await expect(t.action(checkAccess, {})).resolves.toEqual({
    scope: `example-boat:${grant.scope}`,
    subject: grant.subject,
    issuer,
  });
  await expect(
    t.action(checkAccess, { scope: "foreign", subject: "operator" }),
  ).rejects.toThrow();
  await expect(t.query(session, {})).resolves.toMatchObject({
    state: "authorized",
    scope: `example-boat:${grant.scope}`,
    subject: grant.subject,
  });
});
test("missing malformed and duplicate policy fail closed", async () => {
  const t = fixture().withIdentity({ issuer, subject: "operator" });
  for (const policy of [
    "",
    "{",
    "{}",
    JSON.stringify([grant, grant]),
    JSON.stringify([{ ...grant, scope: "" }]),
  ]) {
    vi.stubEnv("EXAMPLE_OPERATOR_GRANTS", policy);
    await expect(t.action(checkAccess, {})).rejects.toMatchObject({
      data: { code: "authorization" },
    });
    await expect(t.query(session, {})).resolves.toEqual({ state: "forbidden" });
  }
});

test("development auth supports Convex's get-only environment proxy", async () => {
  const { developmentAuthConfig } = await import("./authConfig");
  // Match the Convex runtime's get-only Proxy over an empty target. An own-key
  // guard would incorrectly hide the configured issuer too.
  const environment = (value?: string) =>
    new Proxy(
      {},
      {
        get: (_, key) => {
          if (key !== "CLERK_JWT_ISSUER_DOMAIN")
            throw new Error("Unexpected environment access");
          if (value === undefined)
            throw new Error(
              "Environment variable CLERK_JWT_ISSUER_DOMAIN is used in auth config file but its value was not set",
            );
          return value;
        },
      },
    );
  expect(developmentAuthConfig(environment())).toEqual({ providers: [] });
  expect(developmentAuthConfig(environment(issuer))).toEqual({
    providers: [{ domain: issuer, applicationID: "convex" }],
  });
  for (const invalid of [
    "http://synthetic.clerk.accounts.dev",
    "https://foreign.example.test",
    `${issuer}/path`,
  ])
    expect(() => developmentAuthConfig(environment(invalid))).toThrow();
  expect(() =>
    developmentAuthConfig(
      new Proxy(
        {},
        {
          get: () => {
            throw new Error("Unknown runtime failure");
          },
        },
      ),
    ),
  ).toThrow("Unknown runtime failure");
});

test("auth config propagates unrelated errors containing missing-variable text", async () => {
  const { developmentAuthConfig } = await import("./authConfig");
  const message =
    "Fatal runtime failure: Environment variable CLERK_JWT_ISSUER_DOMAIN is used in auth config file but its value was not set; abort";
  expect(() =>
    developmentAuthConfig(
      new Proxy(
        {},
        {
          get: () => {
            throw new Error(message);
          },
        },
      ),
    ),
  ).toThrow(message);
});
