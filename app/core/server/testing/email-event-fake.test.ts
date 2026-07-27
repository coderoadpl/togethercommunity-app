import { describe, expect, it } from 'vitest';

import { emailEventSchema, type EmailEvent } from '@core/domain/index.js';

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
