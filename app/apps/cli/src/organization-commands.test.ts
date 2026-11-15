import { describe, expect, it, vi } from 'vitest';

import { ok } from '#core/domain/index.js';

import { readSecretValue, resolveOrganizationId, resolveWorkspaceId } from './organization-commands.js';

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

describe('organization CLI workspace selection', () => {
  const tenants = () => ({
    listTenants: vi.fn(async () => ok({
      tenants: [{ tenant: { id: 'tenant-acme', slug: 'acme', name: 'Acme', status: 'active' as const, plan: 'hosted' as const, contentVersion: 1 }, staffRole: 'owner' as const, source: 'direct' as const }],
      memberTenants: [],
      canCreateTenant: false,
      dataResetEnvironment: null,
    })),
  });

  it('resolves a workspace slug or id from the caller staff workspaces', async () => {
    expect(await resolveWorkspaceId(tenants(), 'ACME')).toEqual({ ok: true, value: 'tenant-acme' });
    expect(await resolveWorkspaceId(tenants(), 'tenant-acme')).toEqual({ ok: true, value: 'tenant-acme' });
    expect(await resolveWorkspaceId(tenants(), 'studio')).toMatchObject({ ok: false, error: { code: 'not_found' } });
    const client = tenants();
    expect(await resolveWorkspaceId(client, ' ')).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(client.listTenants).not.toHaveBeenCalled();
  });
});

describe('organization CLI secret input', () => {
  const stdin = (text: string, isTTY = false) => ({
    isTTY,
    async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(text); },
  });

  it('reads the named environment variable, trimmed, before stdin', async () => {
    expect(await readSecretValue('ORG_SECRET', { env: { ORG_SECRET: ' value-1 ' }, stdin: stdin('ignored') })).toEqual({ ok: true, value: 'value-1' });
    expect(await readSecretValue('ORG_SECRET', { env: { ORG_SECRET: ' ' }, stdin: stdin('ignored') }))
      .toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('reads piped stdin and refuses an interactive terminal or an empty value', async () => {
    expect(await readSecretValue(undefined, { env: {}, stdin: stdin('piped-value\n') })).toEqual({ ok: true, value: 'piped-value' });
    expect(await readSecretValue(undefined, { env: {}, stdin: stdin('typed', true) })).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await readSecretValue(undefined, { env: {}, stdin: stdin('\n') })).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});
