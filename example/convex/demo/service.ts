import type { ActionCtx, QueryCtx } from "../_generated/server.js";
import { internal, components } from "../_generated/api.js";
import {
  SandboxProviders,
  createLifecycleStore,
  createExecutionStore,
  createFileStore,
  createImageStore,
  type CommandInput,
} from "@fantastic.dev/convex-sandbox";
import {
  createHostAccess,
  protectExecutionStore,
  withSandboxErrors,
} from "@fantastic.dev/convex-sandbox/server";
import { createSimulatedProvider } from "@fantastic.dev/convex-sandbox/testing";
import {
  localFixture,
  profiles,
  scopeFor,
  providerFor,
  deny,
  type Profile,
  type Scenario,
} from "./contracts.js";

export function accessFor(ctx: Pick<QueryCtx, "runQuery">, epoch: number) {
  return createHostAccess({
    authenticate: async () => ({
      subject: "local-fixture-only",
      scope: scopeFor(epoch),
    }),
    getSandbox: (sandbox) =>
      ctx.runQuery(components.sandbox.registry.get, { sandbox }),
    listSandboxes: (scope, page) =>
      ctx.runQuery(components.sandbox.registry.list, {
        scope,
        paginationOpts: { cursor: page.cursor, numItems: page.limit },
      }),
    authorize: async ({ sandbox, reference }) =>
      profiles.some(
        (profile) =>
          sandbox.key === profile &&
          (!reference || reference.provider === providerFor(profile)),
      ),
    selectProvider: async (_, key) => {
      if (!profiles.includes(key as Profile)) return deny("authorization");
      return providerFor(key as Profile);
    },
    authorizePath: async ({ path }) =>
      path === "/workspace" || path.startsWith("/workspace/"),
  });
}
export async function withLease<T>(
  ctx: ActionCtx,
  reset: boolean,
  requireSeeded: boolean,
  call: (lease: {
    epoch: number;
    token: number;
    initialized: boolean;
  }) => Promise<T>,
): Promise<T> {
  return withSandboxErrors(async () => {
    localFixture();
    const lease = await ctx.runMutation(internal.demo.store.acquire, { reset });
    try {
      if (requireSeeded && !lease.initialized) deny("stale_resource");
      return await call(lease);
    } finally {
      await ctx.runMutation(internal.demo.store.release, {
        epoch: lease.epoch,
        token: lease.token,
      });
    }
  });
}
export async function services(
  ctx: ActionCtx,
  lease: { epoch: number; token: number },
  profile: Profile,
) {
  const selection = { epoch: lease.epoch, token: lease.token };
  const json = await ctx.runQuery(internal.demo.store.load, {
    ...selection,
    profile,
  });
  const simulated = createSimulatedProvider({
    name: providerFor(profile),
    profile,
    ...(json === null ? {} : { state: JSON.parse(json) }),
    onChange: async (state) => {
      await ctx.runMutation(internal.demo.store.save, {
        ...selection,
        profile,
        stateJson: JSON.stringify(state),
      });
    },
  });
  const access = accessFor(ctx, lease.epoch),
    providers = new SandboxProviders({
      authorize: access.authorize,
      authorizeCreate: access.authorizeCreate,
    });
  providers.register(simulated.provider);
  const executionStore = protectExecutionStore(
    createExecutionStore(ctx, components.sandbox),
    {
      retention: "redacted",
      redact: (text) =>
        text === "Hello from convex-sandbox.\n" ||
        text === "Background fixture completed.\n" ||
        /^x+$/.test(text)
          ? text
          : "[redacted]",
    },
  );
  return {
    simulated,
    access,
    sandbox: { scope: scopeFor(lease.epoch), key: profile },
    lifecycle: providers.lifecycle(
      createLifecycleStore(ctx, components.sandbox),
    ),
    execution: providers.execution(executionStore),
    files: providers.files({
      ...createFileStore(ctx, components.sandbox),
      authorizePath: access.authorizePath,
    }),
    images: providers.images(createImageStore(ctx, components.sandbox)),
  };
}
export const commandFor = (scenario: Scenario): CommandInput => ({
  kind: "argv",
  executable: "fixture",
  args:
    scenario === "background"
      ? ["progress", "3", "Background fixture completed."]
      : scenario === "large-output"
        ? ["generate", "100000"]
        : scenario === "nonzero"
          ? ["exit", "7"]
          : ["echo", "Hello from convex-sandbox."],
});
export async function seedAll(
  ctx: ActionCtx,
  lease: { epoch: number; token: number; initialized: boolean },
) {
  if (!lease.initialized) {
    for (const profile of profiles) {
      const client = await services(ctx, lease, profile),
        operationId = `seed-${lease.epoch}-${profile}`;
      const provision = await ctx.runQuery(
        components.sandbox.lifecycle.getProvision,
        { sandbox: client.sandbox },
      );
      if (provision && ["unknown", "running"].includes(provision.status))
        await client.lifecycle.reconcileCreate({
          sandbox: client.sandbox,
          operationId,
        });
      await client.lifecycle.create({
        sandbox: client.sandbox,
        provider: providerFor(profile),
        operationId,
      });
      if (!(await client.lifecycle.get(client.sandbox))) deny("stale_resource");
      await client.files.writeText({
        sandbox: client.sandbox,
        path: "/workspace/README.txt",
        text: `Synthetic ${profile} fixture. No real shell, VM or provider credentials.\n`,
        operationId: "seed-readme",
      });
    }
    await ctx.runMutation(internal.demo.store.complete, {
      epoch: lease.epoch,
      token: lease.token,
    });
  }
  return {
    mode: "simulation" as const,
    epoch: lease.epoch,
    profiles: 3 as const,
  };
}
