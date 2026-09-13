import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import {
  API_PATHS,
  authSendLogLatestOutputSchema,
  envelopeSchema,
  SCHEDULER_OPERATOR_SECRET_HEADER,
} from '#core/contract/index.js';
import {
  SMOKE_TENANT_MEMBER_EMAIL,
  type EmailSendProjection,
  type Tenant,
} from '#core/domain/index.js';

import type { AppVars } from './app-vars.js';
import { registerAuthSendLogLatestRoute } from './internal-app.js';

const acme: Tenant = {
  id: 'tenant-acme',
  slug: 'acme',
  name: 'Acme',
  status: 'active',
  plan: 'hosted',
  contentVersion: 1,
};

const globex: Tenant = {
  ...acme,
  id: 'tenant-globex',
  slug: 'globex',
  name: 'Globex',
};

const SINCE = '2026-09-13T10:00:00.000Z';

const sent: EmailSendProjection = {
  id: 'auth-send-1',
  tenantId: acme.id,
  kind: 'transactional',
  recipient: SMOKE_TENANT_MEMBER_EMAIL,
  subject: 'auth-magic-link',
  sourceKind: 'auth-magic-link',
  source: 'auth-magic-link',
  sourceApp: null,
  status: 'sent',
  skipReason: null,
  failureCode: null,
  failureMessage: null,
  deliveryStatus: null,
  deliveryOccurredAt: null,
  campaignId: null,
  campaignName: null,
  sesMessageId: 'provider-message-1',
  transport: 'platform',
  createdAt: '2026-09-13T10:00:01.000Z',
  sentAt: '2026-09-13T10:00:02.000Z',
};

const queued: EmailSendProjection = { ...sent, id: 'auth-send-queued', status: 'queued', sentAt: null };

const failed: EmailSendProjection = { ...sent, id: 'auth-send-failed', status: 'failed', sentAt: null };

const beforeTheRequest: EmailSendProjection = {
  ...sent,
  id: 'auth-send-stale',
  createdAt: '2026-09-13T09:59:59.999Z',
  sentAt: '2026-09-13T09:59:59.999Z',
};

const anotherSourceKind: EmailSendProjection = {
  ...sent,
  id: 'auth-send-password-reset',
  sourceKind: 'auth-password-reset',
  createdAt: '2026-09-13T10:00:03.000Z',
  sentAt: '2026-09-13T10:00:04.000Z',
};

const anotherTransport: EmailSendProjection = {
  ...sent,
  id: 'auth-send-tenant-ses',
  transport: 'tenant-ses',
  createdAt: '2026-09-13T10:00:03.000Z',
  sentAt: '2026-09-13T10:00:04.000Z',
};

const createApp = (rows: EmailSendProjection[] = [sent]) => {
  const listByEmailAcrossKinds = vi.fn(async (tenantId: string, email: string) =>
    tenantId === acme.id && email === SMOKE_TENANT_MEMBER_EMAIL ? rows : []);
  const app = new Hono<AppVars>();
  registerAuthSendLogLatestRoute(app, {
    operatorSecret: 'operator-secret',
    tenants: {
      findBySlug: async (slug) => [acme, globex].find((tenant) => tenant.slug === slug) ?? null,
    },
    marketing: { emailSends: { listByEmailAcrossKinds } },
  });
  return { app, listByEmailAcrossKinds };
};

const evidenceUrl = (tenant = 'acme') => {
  const url = new URL(API_PATHS.authSendLogLatest, 'http://localhost');
  url.searchParams.set('tenant', tenant);
  url.searchParams.set('kind', 'magic-link');
  url.searchParams.set('since', SINCE);
  return url;
};

const evidenceOf = async (
  rows: EmailSendProjection[],
  tenant = 'acme',
): Promise<unknown> => {
  const { app } = createApp(rows);
  const response = await app.request(evidenceUrl(tenant), {
    headers: { [SCHEDULER_OPERATOR_SECRET_HEADER]: 'operator-secret' },
  });
  expect(response.status).toBe(200);
  return envelopeSchema(authSendLogLatestOutputSchema.nullable()).parse(await response.json());
};

describe('internal auth send-log evidence route', () => {
  it('requires the operator secret', async () => {
    const { app, listByEmailAcrossKinds } = createApp();

    expect((await app.request(evidenceUrl())).status).toBe(401);
    expect((await app.request(evidenceUrl(), {
      headers: { [SCHEDULER_OPERATOR_SECRET_HEADER]: 'wrong-secret' },
    })).status).toBe(401);
    expect(listByEmailAcrossKinds).not.toHaveBeenCalled();
  });

  it('returns only redacted settlement evidence scoped to the requested tenant', async () => {
    const { app, listByEmailAcrossKinds } = createApp();
    const response = await app.request(evidenceUrl(), {
      headers: { [SCHEDULER_OPERATOR_SECRET_HEADER]: 'operator-secret' },
    });
    const payload = envelopeSchema(authSendLogLatestOutputSchema.nullable())
      .parse(await response.json());

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ok: true,
      data: {
        status: 'sent',
        kind: 'magic-link',
        queuedAt: '2026-09-13T10:00:01.000Z',
        settledAt: '2026-09-13T10:00:02.000Z',
      },
    });
    expect(JSON.stringify(payload)).not.toContain(SMOKE_TENANT_MEMBER_EMAIL);
    expect(JSON.stringify(payload)).not.toContain('provider-message-1');
    expect(listByEmailAcrossKinds).toHaveBeenCalledWith(acme.id, SMOKE_TENANT_MEMBER_EMAIL);

    const otherTenant = await app.request(evidenceUrl('globex'), {
      headers: { [SCHEDULER_OPERATOR_SECRET_HEADER]: 'operator-secret' },
    });
    expect(await otherTenant.json()).toEqual({ ok: true, data: null });
    expect(listByEmailAcrossKinds).toHaveBeenLastCalledWith(
      globex.id,
      SMOKE_TENANT_MEMBER_EMAIL,
    );
  });

  it('ignores a row queued before the requested window', async () => {
    expect(await evidenceOf([beforeTheRequest])).toEqual({ ok: true, data: null });
    expect(await evidenceOf([beforeTheRequest, sent])).toEqual({
      ok: true,
      data: {
        status: 'sent',
        kind: 'magic-link',
        queuedAt: sent.createdAt,
        settledAt: sent.sentAt,
      },
    });
  });

  it('ignores rows of another source kind or another transport', async () => {
    expect(await evidenceOf([anotherSourceKind, anotherTransport]))
      .toEqual({ ok: true, data: null });
    expect(await evidenceOf([anotherSourceKind, anotherTransport, queued])).toEqual({
      ok: true,
      data: {
        status: 'queued',
        kind: 'magic-link',
        queuedAt: queued.createdAt,
        settledAt: null,
      },
    });
  });

  it('reports an unsettled row as queued and a failed row without a settlement timestamp', async () => {
    expect(await evidenceOf([queued])).toEqual({
      ok: true,
      data: {
        status: 'queued',
        kind: 'magic-link',
        queuedAt: queued.createdAt,
        settledAt: null,
      },
    });
    expect(await evidenceOf([failed])).toEqual({
      ok: true,
      data: {
        status: 'failed',
        kind: 'magic-link',
        queuedAt: failed.createdAt,
        settledAt: null,
      },
    });
  });
});
