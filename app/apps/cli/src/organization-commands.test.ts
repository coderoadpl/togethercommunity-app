import { describe, expect, it, vi } from 'vitest';

import { ok } from '#core/domain/index.js';

import { resolveOrganizationId } from './organization-commands.js';

const api = () => ({
  listOrganizations: vi.fn(async () => ok({
    organizations: [{ id: 'org-1', slug: 'holding', name: 'Holding', status: 'active' as const, role: 'owner' as const }],
  })),
});

describe('organization CLI selection', () => {
  it('resolves --org by id or slug before TOGETHER_CLI_ORG', async () => {
    expect(await resolveOrganizationId(api(), 'org-1', { TOGETHER_CLI_ORG: 'ignored' })).toEqual({ ok: true, value: 'org-1' });
    expect(await resolveOrganizationId(api(), 'Holding', {})).toEqual({ ok: true, value: 'org-1' });
    expect(await resolveOrganizationId(api(), undefined, { TOGETHER_CLI_ORG: 'holding' })).toEqual({ ok: true, value: 'org-1' });
  });

  it('asks for a selection and reports organizations the caller does not belong to', async () => {
    const client = api();
    expect(await resolveOrganizationId(client, undefined, {})).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(client.listOrganizations).not.toHaveBeenCalled();
    expect(await resolveOrganizationId(client, 'elsewhere', {})).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});
