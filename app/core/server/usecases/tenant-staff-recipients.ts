import type {
  TenantAccessReader,
  TenantRepository,
} from '../ports.js';

export const tenantStaffRecipients = async (
  tenantId: string,
  deps: {
    tenants: TenantRepository;
    tenantAccess: TenantAccessReader;
  },
): Promise<string[]> => {
  const settings = await deps.tenants.findSettings(tenantId);
  if (settings?.supportEmail) return [settings.supportEmail];
  const staff = await deps.tenantAccess.listStaffForTenant(tenantId);
  return [...new Set(staff.map((member) => member.email))];
};
