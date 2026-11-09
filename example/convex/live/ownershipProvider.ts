import {
  createBoatProvider,
  type BoatOptions,
} from "@fantastic.dev/convex-sandbox/boat";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";

/** The shared clients still own claims and lifecycle. Export before dispatch and before returning native IDs. */
export function ownershipProvider(
  ctx: ActionCtx,
  options: BoatOptions,
  key: string,
  kind: "create" | "fork",
) {
  const provider = createBoatProvider(options);
  const retain = async (nativeId?: string) => {
    await ctx.runAction(internal.live.ownership.retain, {
      key,
      kind,
      ...(nativeId ? { nativeId } : {}),
    });
  };
  if (kind === "create") {
    const create = provider.adapter.create;
    if (!create) throw Error("Boat create adapter missing");
    provider.adapter.create = async (request, context) => {
      await retain();
      const result = await create(request, context);
      await retain(result.providerId);
      return result;
    };
  } else {
    const images = provider.adapter.images;
    const fork = images?.fork;
    if (!images || !fork) throw Error("Boat fork adapter missing");
    images.fork = async (id, context) => {
      await retain();
      const result = await fork(id, context);
      if (result.state === "pending" && result.acceptedMachine)
        await retain(result.acceptedMachine.providerId);
      if (result.state === "ready" && "machine" in result.result)
        await retain(result.result.machine.providerId);
      return result;
    };
  }
  return provider;
}
