import {
  err,
  forbidden,
  impersonationReadOnly,
  LIST_LAYOUT_MAX_BYTES,
  listLayoutIdSchema,
  listLayoutSchema,
  ok,
  validation,
  type AppError,
  type ListLayout,
  type ListLayoutId,
  type Result,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { ListLayoutRepository } from '../ports.js';

export interface ListLayoutDeps {
  listLayouts: ListLayoutRepository;
}

type LayoutKey = { tenantId: string; listId: ListLayoutId };

const layoutKey = (ctx: Ctx, listId: unknown, tenant: Result<string, AppError>): Result<LayoutKey, AppError> => {
  const parsed = listLayoutIdSchema.safeParse(listId);
  if (!parsed.success) return err(validation('Unknown list', parsed.error.flatten()));
  if (!tenant.ok) return tenant;
  if (ctx.machineActor !== undefined) return err(forbidden('List layouts belong to a signed-in person'));
  return ok({ tenantId: tenant.value, listId: parsed.data });
};

const writableLayoutKey = (ctx: Ctx, key: Result<LayoutKey, AppError>): Result<LayoutKey, AppError> =>
  !key.ok || ctx.impersonation === undefined ? key : err(impersonationReadOnly());

export const getListLayout = async (
  ctx: Ctx,
  listId: unknown,
  deps: ListLayoutDeps,
): Promise<Result<{ layout: ListLayout | null }, AppError>> => {
  const owner = layoutKey(ctx, listId, authorizeTenant(ctx, 'order:read'));
  if (!owner.ok) return owner;
  return ok({ layout: await deps.listLayouts.get(owner.value.tenantId, ctx.identity.userId, owner.value.listId) });
};

export const saveListLayout = async (
  ctx: Ctx,
  listId: unknown,
  layout: unknown,
  deps: ListLayoutDeps,
): Promise<Result<{ layout: ListLayout }, AppError>> => {
  const owner = writableLayoutKey(ctx, layoutKey(ctx, listId, authorizeTenant(ctx, 'order:read')));
  if (!owner.ok) return owner;
  const parsed = listLayoutSchema.safeParse(layout);
  if (!parsed.success) return err(validation('Invalid list layout', parsed.error.flatten()));
  if (JSON.stringify(parsed.data).length > LIST_LAYOUT_MAX_BYTES) {
    return err(validation(`A list layout is at most ${String(LIST_LAYOUT_MAX_BYTES)} characters`));
  }
  await deps.listLayouts.put(owner.value.tenantId, ctx.identity.userId, owner.value.listId, parsed.data);
  return ok({ layout: parsed.data });
};

export const resetListLayout = async (
  ctx: Ctx,
  listId: unknown,
  deps: ListLayoutDeps,
): Promise<Result<{ reset: true }, AppError>> => {
  const owner = writableLayoutKey(ctx, layoutKey(ctx, listId, authorizeTenant(ctx, 'order:read')));
  if (!owner.ok) return owner;
  await deps.listLayouts.delete(owner.value.tenantId, ctx.identity.userId, owner.value.listId);
  return ok({ reset: true });
};
