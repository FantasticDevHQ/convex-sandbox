import { action, type ActionCtx } from "../_generated/server";
import { components } from "../_generated/api";
import { v } from "convex/values";
import {
  createFileStore,
  fileReadValidator,
  fileWriteValidator,
  fileDeleteValidator,
  fileListValidator,
  type FileOperation,
} from "@fantastic.dev/convex-sandbox";
import {
  HOME_FILE_ROOT,
  HOME_FILE_BYTES,
  homePathAllowed,
} from "../../shared/file-policy";
import { requireOperator } from "./operator";
import { ownedBoatClient } from "./boatHost";
import { refuse } from "./allowanceModel";
const target = {
  key: v.string(),
  generation: v.number(),
  providerId: v.string(),
};
const file = { ...target, path: v.string() };
type Target = { key: string; generation: number; providerId: string };
function checkedPath(path: string) {
  if (!homePathAllowed(path))
    refuse("Choose a direct file inside /home/user/demo.");
}
function intent(id: string) {
  if (!/^file-[a-zA-Z0-9_-]{1,80}$/.test(id))
    refuse("Keep a valid original file operation identity.");
}
async function client(ctx: ActionCtx, input: Target, operation: FileOperation) {
  const operator = await requireOperator(ctx);
  const sandbox = { scope: operator.scope, key: input.key };
  const row = await ctx.runQuery(components.sandbox.registry.get, { sandbox });
  const mutable = operation === "writeFile" || operation === "deleteFile";
  if (
    !row ||
    row.tombstone ||
    row.reference.provider !== "boat" ||
    row.reference.providerId !== input.providerId ||
    row.generation !== input.generation ||
    (mutable && (row.observedState !== "running" || row.activeOperationId))
  )
    refuse("Observe the original owned binding before changing its files.");
  const c = await ownedBoatClient(ctx, input.key, operation, mutable);
  if (
    c.generation !== input.generation ||
    c.reference.providerId !== input.providerId
  )
    refuse("The selected binding changed.");
  return {
    sandbox: c.sandbox,
    files: c.providers.files({
      ...createFileStore(ctx, components.sandbox),
      getSandbox: async (key) => {
        const current = await ctx.runQuery(components.sandbox.registry.get, {
          sandbox: key,
        });
        return current?.generation === input.generation &&
          current.reference.providerId === input.providerId
          ? current
          : null;
      },
      authorizePath: ({ path, operation, maxBytes, entryKind }) =>
        homePathAllowed(path, operation === "listFiles") &&
        (maxBytes ?? 0) <= HOME_FILE_BYTES &&
        (!entryKind || entryKind === "file"),
    }),
  };
}
export const list = action({
  args: target,
  returns: fileListValidator,
  handler: async (ctx, args) => {
    const c = await client(ctx, args, "listFiles");
    return c.files.list({
      sandbox: c.sandbox,
      path: HOME_FILE_ROOT,
      limit: 50,
    });
  },
});
export const read = action({
  args: file,
  returns: fileReadValidator,
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    checkedPath(args.path);
    const c = await client(ctx, args, "readFile");
    return c.files.read({
      sandbox: c.sandbox,
      path: args.path,
      maxBytes: HOME_FILE_BYTES,
    });
  },
});
export const write = action({
  args: { ...file, data: v.bytes(), operationId: v.string() },
  returns: fileWriteValidator,
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    checkedPath(args.path);
    intent(args.operationId);
    if (args.data.byteLength > HOME_FILE_BYTES)
      refuse("Files must fit within 64 KiB.");
    const c = await client(ctx, args, "writeFile");
    return c.files.write({
      sandbox: c.sandbox,
      path: args.path,
      data: args.data,
      operationId: args.operationId,
    });
  },
});
export const remove = action({
  args: { ...file, confirmPath: v.string(), operationId: v.string() },
  returns: fileDeleteValidator,
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    checkedPath(args.path);
    intent(args.operationId);
    if (args.confirmPath !== args.path) refuse("Confirm the exact file path.");
    const c = await client(ctx, args, "deleteFile");
    return c.files.delete({
      sandbox: c.sandbox,
      path: args.path,
      operationId: args.operationId,
    });
  },
});
