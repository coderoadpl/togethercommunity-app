import { describe, expect, it } from 'vitest';

import type { EmailEvent, EmailSendProjection, Identity } from '@core/domain/index.js';

import type { Ctx } from '../context.js';
import type { EmailSendRepository } from '../ports.js';
import {
  exportEmailSends,
  getEmailSend,
  listEmailSends,
  listMemberEmailSends,
} from './email-send-observability.js';

const identity = (staffRole: Identity['staffRole'] = 'owner'): Ctx => ({ identity: {
  userId: 'staff-1',
  email: 'staff@example.test',
  name: 'Staff',
  tenantId: 'tenant-1',
  tenantSlug: 'alpha',
  tenantName: 'Alpha',
  staffRole,
  memberId: null,
} });

const sends: EmailSendProjection[] = [
  {
    id: 'marketing-1',
    tenantId: 'tenant-1',
    kind: 'marketing',
    recipient: '=member@example.test',
    subject: 'Launch, today',
    source: 'broadcast',
    status: 'sent',
    skipReason: null,
    failureCode: null,
    failureMessage: null,
    deliveryStatus: 'delivered',
    deliveryOccurredAt: '2026-07-25T11:00:00.000Z',
    campaignId: 'campaign-1',
    campaignName: 'Launch',
    sesMessageId: 'ses-1',
    transport: 'tenant-ses',
    createdAt: '2026-07-25T10:00:00.000Z',
    sentAt: '2026-07-25T10:01:00.000Z',
  },
  {
    id: 'transactional-1',
    tenantId: 'tenant-1',
    kind: 'transactional',
    recipient: 'member@example.test',
    subject: 'Welcome',
    source: 'welcome-set-password',
    status: 'sent',
    skipReason: null,
    failureCode: null,
    failureMessage: null,
    deliveryStatus: null,
    deliveryOccurredAt: null,
    transport: 'platform',
    campaignId: null,
    campaignName: null,
    sesMessageId: 'ses-2',
    createdAt: '2026-07-24T10:00:00.000Z',
    sentAt: '2026-07-24T10:01:00.000Z',
  },
];

const event: EmailEvent = {
  id: 'event-1',
  tenantId: 'tenant-1',
  mailKind: 'marketing',
  refId: 'marketing-1',
  type: 'accepted',
  occurredAt: '2026-07-25T10:01:00.000Z',
  meta: { sesMessageId: 'ses-1' },
  createdAt: '2026-07-25T10:01:00.000Z',
};

const queries: unknown[] = [];
const repository: EmailSendRepository = {
  listPage: async (_tenantId, query) => {
    queries.push(query);
    return { sends: sends.slice(0, query.limit), nextCursor: null };
  },
  findById: async (_tenantId, kind, id) =>
    sends.find((send) => send.kind === kind && send.id === id) ?? null,
  listByEmailAcrossKinds: async (_tenantId, email) =>
    email === 'member@example.test' ? sends : [],
};

describe('email send observability use-cases', () => {
  it('validates filters, scopes reads to staff, and returns full ordered history', async () => {
    const listed = await listEmailSends(identity(), { kind: 'marketing', limit: 25 }, { sends: repository });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.sends.map((send) => send.id)).toEqual(['marketing-1', 'transactional-1']);
    expect(queries).toEqual([{ kind: 'marketing', limit: 25 }]);

    const detail = await getEmailSend(identity(), { kind: 'marketing', id: 'marketing-1' }, {
      sends: repository,
      events: {
        append: async () => undefined,
        listByRef: async () => [event],
        listByEmailAcrossKinds: async () => [event],
        purgeEngagement: async () => 0,
        reputationCounts: async () => ({ sends: 0, hardBounces: 0, complaints: 0 }),
      },
    });
    expect(detail).toEqual({ ok: true, value: { send: sends[0], events: [event] } });
    expect(await listEmailSends(identity(null), {}, { sends: repository })).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });

  it('resolves member mail by tenant member id and links projections across kinds', async () => {
    const result = await listMemberEmailSends(identity(), { memberId: 'member-1' }, {
      sends: repository,
      members: {
        findById: async () => ({
          id: 'member-1',
          tenantId: 'tenant-1',
          userId: 'user-1',
          email: 'member@example.test',
          displayName: null,
          tags: [],
          marketingConsents: {},
          externalCustomerIds: {},
          createdAt: '2026-07-01T00:00:00.000Z',
          deletedAt: null,
        }),
        findByEmail: async () => null,
        listWithProductIds: async () => [],
        create: async () => undefined,
        updateEmail: async () => null,
      },
    });
    expect(result).toEqual({ ok: true, value: { sends } });
  });

  it('exports every matching row as formula-safe csv', async () => {
    const result = await exportEmailSends(
      identity(),
      { format: 'csv', runId: 'scheduler-run-1' },
      { sends: repository },
    );
    expect(result).toMatchObject({
      ok: true,
      value: { filename: 'email-sends-alpha.csv', mimeType: 'text/csv; charset=utf-8' },
    });
    if (!result.ok) return;
    expect(queries.at(-1)).toMatchObject({ runId: 'scheduler-run-1' });
    expect(result.value.content.split('\n')[0]).toBe(
      'kind,recipient,subject,status,delivery_status,transport,campaign,source,sent_at,created_at',
    );
    expect(result.value.content).toContain('"\'=member@example.test"');
    expect(result.value.content).toContain('"Launch, today"');
  });
});
