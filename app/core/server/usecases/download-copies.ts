import { downloadCopyQuerySchema, err, ok, validation, type AppError, type DownloadCopy, type Result } from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { DownloadCopyRepository } from '../download-copy-ports.js';

export const listDownloadCopies = async (
  ctx: Ctx,
  query: unknown,
  deps: { downloadCopies: DownloadCopyRepository },
): Promise<Result<{ copies: DownloadCopy[] }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'order:read');
  if (!tenant.ok) return tenant;
  const parsed = downloadCopyQuerySchema.safeParse(query);
  if (!parsed.success) return err(validation('Invalid copy lookup', parsed.error.flatten()));
  return ok({ copies: await deps.downloadCopies.list(tenant.value, parsed.data) });
};
