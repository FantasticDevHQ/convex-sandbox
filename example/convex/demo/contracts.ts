import { v } from "convex/values";
import {
  capabilitiesValidator,
  connectionHandleValidator,
  fileTransferValidator,
} from "@fantastic.dev/convex-sandbox";
import { SandboxProviderError } from "@fantastic.dev/convex-sandbox";
export const profiles = ["ephemeral", "persistent", "memory"] as const;
export type Profile = (typeof profiles)[number];
export const profileValidator = v.union(
  v.literal("ephemeral"),
  v.literal("persistent"),
  v.literal("memory"),
);
export const scenarioValidator = v.union(
  v.literal("hello"),
  v.literal("background"),
  v.literal("large-output"),
  v.literal("nonzero"),
  v.literal("lost-reply"),
  v.literal("rejected"),
);
export type Scenario =
  | "hello"
  | "background"
  | "large-output"
  | "nonzero"
  | "lost-reply"
  | "rejected";
export const leaseValidator = v.object({
  epoch: v.number(),
  token: v.number(),
  initialized: v.boolean(),
});
export const leaseArgs = { epoch: v.number(), token: v.number() };
export const fileIndexValidator = v.array(
  v.object({ path: v.string(), sizeBytes: v.number() }),
);
export const seedResultValidator = v.object({
  mode: v.literal("simulation"),
  epoch: v.number(),
  profiles: v.literal(3),
});
export const infoValidator = v.object({
  mode: v.literal("simulation"),
  localFixture: v.literal(true),
  initialized: v.boolean(),
  epoch: v.number(),
  busy: v.boolean(),
  leaseUntil: v.number(),
  profiles: v.array(
    v.object({
      profile: profileValidator,
      provider: v.string(),
      capabilities: capabilitiesValidator,
    }),
  ),
});
export const fixtureConnectionValidator = v.object({
  mode: v.literal("simulation"),
  functional: v.literal(false),
  handle: connectionHandleValidator,
});
export const fixtureTransferValidator = v.object({
  mode: v.literal("simulation"),
  functional: v.literal(false),
  handle: fileTransferValidator,
});
export function deny(
  code: "validation" | "authorization" | "capacity" | "stale_resource",
): never {
  throw new SandboxProviderError({
    code,
    outcome: "not_started",
    retryable: code === "capacity",
  });
}
export function localFixture() {
  try {
    const url = new URL(process.env.CONVEX_SITE_URL ?? "");
    if (
      ["http:", "https:"].includes(url.protocol) &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
      return;
  } catch {
    /* Fail closed outside the local anonymous backend. */
  }
  deny("authorization");
}
export const scopeFor = (epoch: number) => `example-local-fixture-${epoch}`;
export const providerFor = (profile: Profile) => `simulated-${profile}`;
export function operationId(value: string): string {
  if (
    !value ||
    value.length > 128 ||
    Array.from(value).some((char) => char.charCodeAt(0) < 32)
  )
    deny("validation");
  return value;
}
