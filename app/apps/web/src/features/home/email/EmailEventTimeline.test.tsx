import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { EmailEvent } from '#core/domain/index.js';

import { renderWithProviders } from '../../../test/render.js';
import { LanguageProvider } from '../../../i18n/index.js';
import { en } from '../../../i18n/en.js';
import { formatDateTimeWithSeconds } from '../../../lib/format.js';
import { EmailEventTimeline } from './EmailEventTimeline.js';

const events: EmailEvent[] = [
  {
    id: 'event-1',
    tenantId: 'tenant-1',
    mailKind: 'marketing',
    refId: 'send-1',
    type: 'accepted',
    occurredAt: '2026-07-25T10:01:00.000Z',
    meta: { sesMessageId: 'ses-1', attempt: 1 },
    createdAt: '2026-07-25T10:01:00.000Z',
  },
  {
    id: 'event-2',
    tenantId: 'tenant-1',
    mailKind: 'marketing',
    refId: 'send-1',
    type: 'bounced',
    occurredAt: '2026-07-25T10:02:00.000Z',
    meta: {
      classification: 'hard',
      rawProviderPayload: { bounceType: 'Permanent', bounceSubType: 'General', diagnosticCode: 'smtp; 550 mailbox unavailable' },
    },
    createdAt: '2026-07-25T10:02:00.000Z',
  },
  {
    id: 'event-3',
    tenantId: 'tenant-1',
    mailKind: 'transactional',
    refId: 'send-2',
    type: 'skipped',
    occurredAt: '2026-07-25T10:03:00.000Z',
    meta: { reason: 'suppressed:hard_bounce' },
    createdAt: '2026-07-25T10:03:00.000Z',
  },
];

describe('EmailEventTimeline', () => {
  it('shows ordered salient event metadata and keeps raw metadata expandable', () => {
    renderWithProviders(
      <LanguageProvider>
        <EmailEventTimeline events={events} />
      </LanguageProvider>,
    );

    expect(screen.getAllByTestId('email-event')).toHaveLength(3);
    expect(screen.getByText('ses-1')).toBeInTheDocument();
    expect(screen.getByText(en.marketing.bounceClassifications.hard)).toBeInTheDocument();
    expect(screen.getByText('Permanent')).toBeInTheDocument();
    expect(screen.getByText('General')).toBeInTheDocument();
    expect(screen.getByText('smtp; 550 mailbox unavailable')).toBeInTheDocument();
    expect(screen.getByText(`${en.marketing.suppressionReason}:`)).toBeInTheDocument();
    expect(screen.getByText('suppressed:hard_bounce')).toBeInTheDocument();
    expect(screen.getByText(formatDateTimeWithSeconds(events[0]?.occurredAt ?? '', 'en'))).toBeInTheDocument();
    const rawMetaButtons = screen.getAllByRole('button', { name: en.marketing.rawMeta });
    expect(rawMetaButtons).toHaveLength(3);
    expect(rawMetaButtons.every((button) => button.getAttribute('aria-expanded') === 'false')).toBe(true);
    expect(screen.queryByText(/"attempt"/)).not.toBeInTheDocument();
  });

  it('uses the requested event chip colours', () => {
    renderWithProviders(
      <LanguageProvider>
        <EmailEventTimeline
          events={[
            {
              id: 'opened',
              tenantId: 'tenant-1',
              mailKind: 'marketing',
              refId: 'send-1',
              type: 'opened',
              occurredAt: '2026-07-25T10:04:00.000Z',
              meta: { rawProviderPayload: {} },
              createdAt: '2026-07-25T10:04:00.000Z',
            },
            {
              id: 'clicked',
              tenantId: 'tenant-1',
              mailKind: 'marketing',
              refId: 'send-1',
              type: 'clicked',
              occurredAt: '2026-07-25T10:05:00.000Z',
              meta: { linkUrl: 'https://example.test', rawProviderPayload: {} },
              createdAt: '2026-07-25T10:05:00.000Z',
            },
            {
              id: 'complained',
              tenantId: 'tenant-1',
              mailKind: 'marketing',
              refId: 'send-1',
              type: 'complained',
              occurredAt: '2026-07-25T10:06:00.000Z',
              meta: { rawProviderPayload: {} },
              createdAt: '2026-07-25T10:06:00.000Z',
            },
            {
              id: 'suppressed',
              tenantId: 'tenant-1',
              mailKind: 'marketing',
              refId: 'send-1',
              type: 'suppressed_written',
              occurredAt: '2026-07-25T10:07:00.000Z',
              meta: { reason: 'hard_bounce' },
              createdAt: '2026-07-25T10:07:00.000Z',
            },
          ]}
        />
      </LanguageProvider>,
    );

    expect(screen.getByText(en.marketing.eventTypes.opened).closest('.MuiChip-root')).toHaveClass('MuiChip-colorInfo');
    expect(screen.getByText(en.marketing.eventTypes.clicked).closest('.MuiChip-root')).toHaveClass('MuiChip-colorInfo');
    expect(screen.getByText(en.marketing.eventTypes.complained).closest('.MuiChip-root')).toHaveClass('MuiChip-colorError');
    expect(screen.getByText(en.marketing.eventTypes.suppressed_written).closest('.MuiChip-root')).toHaveClass('MuiChip-colorWarning');
  });
});
