import { describe, expect, it } from 'vitest';

import { emailEventSchema, type EmailEvent } from '#core/domain/index.js';

import { InMemoryEmailEventRepository } from './marketing-fakes.js';

const event = (overrides: Record<string, unknown> = {}): EmailEvent => emailEventSchema.parse({
  id: 'event-1',
  tenantId: 'tenant-1',
  mailKind: 'marketing',
  refId: 'send-1',
  type: 'queued',
  occurredAt: '2026-07-26T10:00:00.000Z',
  meta: null,
  createdAt: '2026-07-26T10:00:00.000Z',
  ...overrides,
});

describe('in-memory email event repository', () => {
  it('scrubs only bounded engagement payloads in the requested tenant', async () => {
    const repository = new InMemoryEmailEventRepository();
    const rows = [
      event({ id: 'open', type: 'opened', meta: { rawProviderPayload: null, retained: true } }),
      event({ id: 'click', type: 'clicked', meta: { linkUrl: 'https://example.test/offer', rawProviderPayload: {} } }),
      event({ id: 'clean', type: 'opened', meta: {} }),
      event({ id: 'empty', type: 'opened', meta: null }),
      event({ id: 'delivery', type: 'delivered', meta: { rawProviderPayload: {} } }),
      event({ id: 'other-tenant', tenantId: 'tenant-2', type: 'opened', meta: { rawProviderPayload: {} } }),
    ];
    for (const row of rows) await repository.append(row.tenantId, row);
    expect(await repository.scrubEngagementPayloads('tenant-1', 0)).toBe(0);
    expect(await repository.scrubEngagementPayloads('tenant-1', 1)).toBe(1);
    expect(await repository.scrubEngagementPayloads('tenant-1', 1000)).toBe(1);
    expect(await repository.scrubEngagementPayloads('tenant-1', 1000)).toBe(0);
    expect(await repository.listByRef('tenant-1', 'marketing', 'send-1')).toEqual([
      { ...rows[0], meta: { retained: true } },
      { ...rows[1], meta: { linkUrl: 'https://example.test/offer' } },
      ...rows.slice(2, 5),
    ]);
    expect(await repository.listByRef('tenant-2', 'marketing', 'send-1')).toEqual([rows[5]]);
  });

  it('only appends and returns stable chronological history', async () => {
    const repository = new InMemoryEmailEventRepository();
    await repository.append('tenant-1', event({ id: 'later', type: 'accepted', occurredAt: '2026-07-26T10:00:02.000Z', meta: { sesMessageId: 'ses-1' } }));
    await repository.append('tenant-1', event({ id: 'first', occurredAt: '2026-07-26T10:00:01.000Z' }));

    expect((await repository.listByRef('tenant-1', 'marketing', 'send-1')).map((item) => item.type))
      .toEqual(['queued', 'accepted']);
    await expect(repository.append('tenant-1', event({ id: 'first', type: 'failed', meta: { error: 'duplicate' } })))
      .rejects.toThrow();
    expect((await repository.listByRef('tenant-1', 'marketing', 'send-1')).map((item) => item.type))
      .toEqual(['queued', 'accepted']);
  });

  it('lists one address across transactional and marketing references without crossing tenants', async () => {
    const repository = new InMemoryEmailEventRepository();
    repository.associateEmail('tenant-1', 'marketing', 'send-1', 'member@example.test');
    repository.associateEmail('tenant-1', 'transactional', 'outbox-1', 'member@example.test');
    repository.associateEmail('tenant-2', 'marketing', 'send-2', 'member@example.test');
    await repository.append('tenant-1', event());
    await repository.append('tenant-1', event({ id: 'event-2', mailKind: 'transactional', refId: 'outbox-1' }));
    await repository.append('tenant-2', event({ id: 'event-3', tenantId: 'tenant-2', refId: 'send-2' }));

    expect((await repository.listByEmailAcrossKinds('tenant-1', 'MEMBER@example.test')).map((item) => item.id))
      .toEqual(['event-1', 'event-2']);
  });
});
