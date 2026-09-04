import { resolveEmailLanguage, type Language } from '#core/domain/index.js';

import type {
  TenantAccessReader,
  TenantRepository,
} from '../ports.js';

export interface StaffRecipient {
  email: string;
  language: Language;
}

export const tenantStaffRecipients = async (
  tenantId: string,
  deps: {
    tenants: TenantRepository;
    tenantAccess: TenantAccessReader;
  },
): Promise<StaffRecipient[]> => {
  const settings = await deps.tenants.findSettings(tenantId);
  const tenantLanguage = settings?.defaultLanguage;
  if (settings?.supportEmail) {
    return [{ email: settings.supportEmail, language: resolveEmailLanguage(tenantLanguage) }];
  }
  const staff = await deps.tenantAccess.listStaffForTenant(tenantId);
  const byEmail = new Map<string, Language>();
  for (const member of staff) {
    if (byEmail.has(member.email)) continue;
    byEmail.set(member.email, resolveEmailLanguage(member.language, tenantLanguage));
  }
  return [...byEmail].map(([email, language]) => ({ email, language }));
};
