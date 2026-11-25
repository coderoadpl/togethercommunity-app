import {
  appError,
  CHANGE_PROPOSAL_REFUSALS,
  err,
  forbidden,
  keyDownloadAttachInputSchema,
  keyDownloadFileCapExceeded,
  keyDownloadRemoveInputSchema,
  notFound,
  ok,
  validation,
  type AppError,
  type KeyDownloadAttachInput,
  type KeyDownloadRemoveInput,
  type ProductDownloadAsset,
  type Result,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import { invalid } from '../change-proposal-access.js';
import type { Ctx } from '../context.js';
import type { KeyDownloadAttachRepository, KeyDownloadFileRepository } from '../key-download-ports.js';
import type { Clock, StorageProvider, TenantSecretResolver } from '../ports.js';
import { finishOwedDeletion } from './key-download-files.js';
import { deleteStoredProductDownload } from './product-downloads.js';
import { resolveStorageConfiguration } from './storage-assets.js';

export interface ProductDownloadAttachDeps {
  keyDownloadAttach: Pick<KeyDownloadAttachRepository, 'attach'>;
  clock: Clock;
  /** The key that staged the file, for a caller that is not that key itself (the owner approving its proposal). */
  stagedByKeyId?: string;
}

/** Makes no storage request, so it runs unchanged inside a caller's transaction, a dry run included. */
export const attachStagedProductDownload = async (
  ctx: Ctx,
  input: KeyDownloadAttachInput,
  deps: ProductDownloadAttachDeps,
): Promise<Result<ProductDownloadAsset, AppError>> => {
  const tenant = authorizeTenant(ctx, 'product:write');
  if (!tenant.ok) return tenant;
  const parsed = keyDownloadAttachInputSchema.safeParse(input);
  if (!parsed.success) return invalid('Invalid product file attachment', parsed.error);
  const actor = ctx.machineActor;
  const apiKeyId = actor?.kind === 'shop_management_key' ? actor.apiKeyId : deps.stagedByKeyId;
  if (apiKeyId === undefined) return err(forbidden('Only a file staged by a shop management key can be attached'));
  const attached = await deps.keyDownloadAttach.attach(tenant.value, {
    productId: parsed.data.productId,
    stagedFileId: parsed.data.stagedFileId,
    apiKeyId,
    replacesAssetId: parsed.data.replacesAssetId,
    versionNote: parsed.data.versionNote ?? null,
    now: deps.clock.nowIso(),
  });
  switch (attached.kind) {
    case 'attached':
      return ok(attached.asset);
    case 'product_not_found':
      return err(notFound(`No product "${parsed.data.productId}" in this tenant`));
    case 'not_digital':
      return err(validation(CHANGE_PROPOSAL_REFUSALS.fileProductNotDigital));
    case 'staged_not_found':
      return err(notFound(`No staged file "${parsed.data.stagedFileId}" of this key`));
    case 'applied_otherwise':
      return err(appError('conflict', 'This staged file was already attached with another replacement or version note; nothing was changed'));
    case 'replacement_not_found':
      return err(notFound(CHANGE_PROPOSAL_REFUSALS.fileReplacementMissing));
    case 'replacement_not_ready':
      return err(validation(CHANGE_PROPOSAL_REFUSALS.fileReplacementNotReady));
    case 'cap_exceeded':
      return err(keyDownloadFileCapExceeded(attached.cap));
  }
};

export interface ProductDownloadRemoveDeps {
  keyDownloadAttach: Pick<KeyDownloadAttachRepository, 'remove'>;
  keyDownloadFiles: Pick<KeyDownloadFileRepository, 'finishDeletion'>;
  storage: StorageProvider;
  secretResolver: TenantSecretResolver;
  clock: Clock;
  logger: { error(message: string): void };
  /** A proposal removes only a ready file: a file still uploading is in no snapshot, so its removal would show no effect. */
  readyOnly?: boolean;
}

/**
 * A key-staged object's deletion is owed in the removing transaction, so the sweep retries a storage delete that fails
 * afterwards; an owner-uploaded object is deleted once, as the product editor deletes it.
 */
export const removeProductDownloadFile = async (
  ctx: Ctx,
  input: KeyDownloadRemoveInput,
  deps: ProductDownloadRemoveDeps,
): Promise<Result<{ deleted: true }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'product:write');
  if (!tenant.ok) return tenant;
  const parsed = keyDownloadRemoveInputSchema.safeParse(input);
  if (!parsed.success) return invalid('Invalid product file removal', parsed.error);
  const configuration = await resolveStorageConfiguration(tenant.value, deps.secretResolver);
  if (!configuration.ok) return configuration;
  const removed = await deps.keyDownloadAttach.remove(tenant.value, { ...parsed.data, readyOnly: deps.readyOnly === true, now: deps.clock.nowIso() });
  if (removed.kind === 'not_found') return err(notFound(`No download asset "${parsed.data.assetId}" on this product`));
  if (removed.kind === 'not_ready') return err(validation(CHANGE_PROPOSAL_REFUSALS.fileRemovalNotReady));
  if (removed.owedDeletion === null) {
    await deleteStoredProductDownload(tenant.value, removed.asset, deps);
  } else {
    await finishOwedDeletion(tenant.value, removed.owedDeletion.objectKey, configuration.value, deps);
  }
  return ok({ deleted: true });
};
