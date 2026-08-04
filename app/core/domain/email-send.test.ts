import { describe, expect, it } from 'vitest';

import {
  emailSendExportQuerySchema,
  emailSendListQuerySchema,
  emailSendProjectionSchema,
} from './email-send.js';

describe('unified email send projection', () => {
  it('parses transactional and marketing rows without erasing kind-specific status', () => {
    const base = {
      id: 'send-1',
      tenantId: 'tenant-1',
      recipient: 'member@example.test',
      subject: 'Welcome',
      deliveryStatus: null,
      deliveryOccurredAt: null,
      campaignId: null,
      campaignName: null,
      sesMessageId: null,
      failureCode: null,
      failureMessage: null,
      createdAt: '2026-07-25T10:00:00.000Z',
      sentAt: null,
    };

    expect(emailSendProjectionSchema.parse({
      ...base,
      kind: 'transactional',
      source: 'welcome-sign-in',
      status: 'queued',
      skipReason: null,
      transport: 'platform',
    }).status).toBe('queued');
    expect(emailSendProjectionSchema.parse({
      ...base,
      kind: 'marketing',
      source: 'api',
      status: 'skipped',
      skipReason: 'not_consented',
      transport: 'tenant-ses',
    }).status).toBe('skipped');
  });

  it('coerces bounded keyset list filters and requires csv for exports', () => {
    expect(emailSendListQuerySchema.parse({
      kind: 'marketing',
      status: 'sent',
      deliveryStatus: 'delivered',
      campaignId: 'campaign-1',
      runId: 'run-1',
      search: 'member@example.test',
      cursor: '2026-07-25T10%3A00%3A00.000Z~marketing~send-1',
      limit: '25',
    })).toMatchObject({ kind: 'marketing', runId: 'run-1', limit: 25 });
    expect(emailSendListQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(emailSendExportQuerySchema.safeParse({ format: 'json' }).success).toBe(false);
    expect(emailSendExportQuerySchema.parse({ format: 'csv' })).toEqual({ format: 'csv' });
  });
});
