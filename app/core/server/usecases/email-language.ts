import { resolveEmailLanguage, type Language } from '#core/domain/index.js';

import type { TenantRepository } from '../ports.js';

export const tenantEmailLanguage = async (
  tenantId: string,
  deps: { tenants: Pick<TenantRepository, 'findSettings'> },
): Promise<Language> =>
  resolveEmailLanguage((await deps.tenants.findSettings(tenantId))?.defaultLanguage);
