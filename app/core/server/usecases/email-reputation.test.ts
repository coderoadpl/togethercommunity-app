import { describe, expect, it } from 'vitest';

import {
  emailEventSchema,
  tenantSettingsSchema,
  type CampaignSend,
  type EmailEvent,
  type EmailReputationCounts,
  type Identity,
  type TenantSesSettings,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  EmailEventRepository,
  TenantAccessReader,
  TenantRepository,
} from '../ports.js';
import {
  InMemoryCampaignSendRepository,
  InMemoryEmailEventRepository,
  InMemoryEmailOutboxRepository,
  InMemoryTenantSesSettingsRepository,
} from '../testing/marketing-fakes.js';
import {
  getEmailReputation,
  runReputationAlerts,
} from './email-reputation.js';
import { tenantStaffRecipients } from './tenant-staff-recipients.js';

const NOW = '2026-07-27T12:00:00.000Z';
const ctx: Ctx = { identity: {
  userId: 'staff-1',
  email: 'staff@example.test',
  name: 'Staff',
  tenantId: 'tenant-1',
  tenantSlug: 'tenant',
  tenantName: 'Tenant',
  staffRole: 'owner',
  memberId: null,
  memberBannedAt: null,
} satisfies Identity };

const event = (
  id: string,
  refId: string,
  type: EmailEvent['type'],
  occurredAt: string,
  meta: unknown,
): EmailEvent => emailEventSchema.parse({
  id,
  tenantId: 'tenant-1',
  mailKind: 'marketing',
  refId,
  type,
  occurredAt,
  meta,
  createdAt: occurredAt,
});

describe('get email reputation', () => {
  it('derives rates from distinct sends and events inside the trailing window', async () => {
    const events = new InMemoryEmailEventRepository();
    const sends = new InMemoryCampaignSendRepository(events);
    for (let index = 0; index < 2_000; index += 1) {
      const sentAt = index === 0 ? '2026-07-20T12:00:00.000Z' : '2026-07-25T12:00:00.000Z';
      const send: CampaignSend = {
        id: `send-${String(index)}`, runId: null, tenantId: 'tenant-1', campaignId: null,
        source: 'api', memberId: null, email: `member-${String(index)}@example.test`,
        subject: 'Reputation', consentRowId: 'consent-1', unsubscribeTokenId: null,
        status: 'sent', skipReason: null, sesMessageId: `ses-${String(index)}`,
        deliveryStatus: null, deliveryOccurredAt: null, idempotencySource: null,
        renderedBodyPurgedAt: null, createdAt: sentAt, sentAt,
      };
      await sends.claimRecipient('tenant-1', send);
    }
    for (let index = 0; index < 100; index += 1) {
      await events.append('tenant-1', event(
        `bounce-${String(index)}`,
        `send-${String(index)}`,
        'bounced',
        '2026-07-26T12:00:00.000Z',
        { classification: 'hard', rawProviderPayload: {} },
      ));
    }
    for (let index = 0; index < 3; index += 1) {
      await events.append('tenant-1', event(
        `complaint-${String(index)}`,
        `send-${String(index + 100)}`,
        'complained',
        '2026-07-26T12:00:00.000Z',
        {},
      ));
    }
    await events.append('tenant-1', event(
      'duplicate-complaint',
      'send-100',
      'complained',
      '2026-07-26T12:01:00.000Z',
      {},
    ));
    await events.append('tenant-1', event(
      'old-bounce',
      'send-old',
      'bounced',
      '2026-07-20T11:59:59.999Z',
      { classification: 'hard', rawProviderPayload: {} },
    ));

    const result = await getEmailReputation(ctx, { events, clock: { nowIso: () => NOW } });

    expect(result).toEqual({
      ok: true,
      value: {
        windowStart: '2026-07-20T12:00:00.000Z',
        windowEnd: NOW,
        hardBounce: { count: 100, sends: 2_000, rate: 0.05, status: 'warn' },
        complaint: { count: 3, sends: 2_000, rate: 0.0015, status: 'critical' },
        overallStatus: 'critical',
      },
    });
  });

  it('requires tenant staff identity', async () => {
    const result = await getEmailReputation({ identity: { ...ctx.identity, staffRole: null } }, {
      events: new InMemoryEmailEventRepository(),
      clock: { nowIso: () => NOW },
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
});

const sesSettings = (): TenantSesSettings => ({
  tenantId: 'tenant-1',
  fromAddress: 'news@tenant.test',
  fromName: 'Tenant',
  identity: 'tenant.test',
  identityVerifiedAt: NOW,
  identityCheckedAt: NOW,
  identityCheckError: null,
  configurationSet: 'marketing',
  snsTopicArn: 'arn:topic',
  trackingEnabled: false,
  autoPauseOnCritical: false,
  webhookToken: 'webhook_token_123456789012345',
  quotaRatePerSec: 10,
  quotaDaily: 1000,
  quotaSentLast24Hours: 0,
  quotaRefreshedAt: NOW,
  inSandbox: false,
  webhookVerifiedAt: NOW,
  footerLegalName: 'Tenant Ltd',
  footerAddress: 'Street 1',
  broadcastsEnabled: true,
  reputationAlertStatus: null,
  reputationAlertedAt: null,
});

describe('run reputation alerts', () => {
  it('sends on warn, dedupes inside the cooldown, repeats, and clears on recovery', async () => {
    let counts: EmailReputationCounts = {
      sends: 1000,
      hardBounces: 50,
      complaints: 0,
    };
    let currentNow = NOW;
    const events: EmailEventRepository = {
      append: async () => undefined,
      listByRef: async () => [],
      listByEmailAcrossKinds: async () => [],
      purgeEngagement: async () => 0,
      reputationCounts: async () => counts,
    };
    const settings = new InMemoryTenantSesSettingsRepository([sesSettings()]);
    const emailOutbox = new InMemoryEmailOutboxRepository();
    const tenant = { id: 'tenant-1', slug: 'tenant', name: 'Tenant', contentVersion: 1 };
    const tenants: TenantRepository = {
      findById: async () => tenant,
      findBySlug: async () => tenant,
      findSettings: async () =>
        tenantSettingsSchema.parse({
          name: 'Tenant',
          billingPortalUrl: null,
          bunnyStreamLibraryId: null,
          supportEmail: 'support@tenant.test',
        }),
      updateSettings: async (_tenantId, value) => value,
      createTenantWithOwnerGrant: async () => tenant,
    };
    const tenantAccess: TenantAccessReader = {
      listTenantsForStaff: async () => [],
      listStaffForTenant: async () => [],
      findStaffGrant: async () => null,
      findMember: async () => null,
    };
    let sequence = 0;
    let dispatches = 0;
    const deps = {
      events,
      settings,
      tenants,
      tenantAccess,
      emailOutbox,
      ids: { nextId: () => `alert-${String(++sequence)}` },
      clock: { nowIso: () => currentNow },
      dashboardUrl: () => 'https://tenant.example.test/panel/marketing',
      dispatchEmail: () => {
        dispatches += 1;
      },
    };

    await expect(runReputationAlerts(ctx, deps)).resolves.toEqual({
      ok: true,
      value: { sent: 1 },
    });
    expect(emailOutbox.items).toMatchObject([
      {
        to: 'support@tenant.test',
        payload: { kind: 'reputation-alert', status: 'warn' },
      },
    ]);
    await expect(runReputationAlerts(ctx, deps)).resolves.toEqual({
      ok: true,
      value: { sent: 0 },
    });
    expect(emailOutbox.items).toHaveLength(1);

    currentNow = '2026-07-28T12:00:00.000Z';
    await expect(runReputationAlerts(ctx, deps)).resolves.toEqual({
      ok: true,
      value: { sent: 1 },
    });
    expect(emailOutbox.items).toHaveLength(2);

    counts = { sends: 0, hardBounces: 0, complaints: 0 };
    await expect(runReputationAlerts(ctx, deps)).resolves.toEqual({
      ok: true,
      value: { sent: 0 },
    });
    expect(await settings.findByTenant('tenant-1')).toMatchObject({
      reputationAlertStatus: null,
      reputationAlertedAt: null,
    });
    expect(dispatches).toBe(2);
  });

  it('does nothing when SES settings do not exist', async () => {
    const result = await runReputationAlerts(ctx, {
      events: new InMemoryEmailEventRepository(),
      settings: new InMemoryTenantSesSettingsRepository(),
      tenants: {
        findById: async () => null,
        findBySlug: async () => null,
        findSettings: async () => null,
        updateSettings: async (_tenantId, value) => value,
        createTenantWithOwnerGrant: async () => {
          throw new Error('not called');
        },
      },
      tenantAccess: {
        listTenantsForStaff: async () => [],
        listStaffForTenant: async () => [],
        findStaffGrant: async () => null,
        findMember: async () => null,
      },
      emailOutbox: new InMemoryEmailOutboxRepository(),
      ids: { nextId: () => 'unused' },
      clock: { nowIso: () => NOW },
      dashboardUrl: () => 'https://tenant.test/panel/marketing',
      dispatchEmail: () => undefined,
    });

    expect(result).toEqual({ ok: true, value: { sent: 0 } });
  });
});

describe('tenant staff recipients', () => {
  const tenants = (supportEmail: string | null): TenantRepository => ({
    findById: async () => null,
    findBySlug: async () => null,
    findSettings: async () =>
      tenantSettingsSchema.parse({
        name: 'Tenant',
        billingPortalUrl: null,
        bunnyStreamLibraryId: null,
        supportEmail,
      }),
    updateSettings: async (_tenantId, value) => value,
    createTenantWithOwnerGrant: async () => {
      throw new Error('not called');
    },
  });
  const tenantAccess = (emails: string[]): TenantAccessReader => ({
    listTenantsForStaff: async () => [],
    listStaffForTenant: async () =>
      emails.map((email, index) => ({ userId: `staff-${String(index)}`, email })),
    findStaffGrant: async () => null,
    findMember: async () => null,
  });

  it('uses the configured support address instead of staff fallback', async () => {
    await expect(
      tenantStaffRecipients('tenant-1', {
        tenants: tenants('support@tenant.test'),
        tenantAccess: tenantAccess(['owner@tenant.test']),
      }),
    ).resolves.toEqual(['support@tenant.test']);
  });

  it('deduplicates owner and admin fallback addresses', async () => {
    await expect(
      tenantStaffRecipients('tenant-1', {
        tenants: tenants(null),
        tenantAccess: tenantAccess([
          'owner@tenant.test',
          'admin@tenant.test',
          'owner@tenant.test',
        ]),
      }),
    ).resolves.toEqual(['owner@tenant.test', 'admin@tenant.test']);
  });
});
