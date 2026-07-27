import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { EmailEvent } from '@core/domain/index.js';

import { renderWithProviders } from '../../../test/render.js';
import { LanguageProvider } from '../../../i18n/index.js';
import { pl } from '../../../i18n/pl.js';
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
    meta: { classification: 'hard', rawProviderPayload: { bounceType: 'Permanent' } },
    createdAt: '2026-07-25T10:02:00.000Z',
  },
];

describe('EmailEventTimeline', () => {
  it('shows ordered salient event metadata and keeps raw metadata expandable', () => {
    renderWithProviders(
      <LanguageProvider>
        <EmailEventTimeline events={events} />
      </LanguageProvider>,
    );

    expect(screen.getAllByTestId('email-event')).toHaveLength(2);
    expect(screen.getByText('ses-1')).toBeInTheDocument();
    expect(screen.getByText('hard')).toBeInTheDocument();
    expect(screen.getAllByText(pl.marketing.rawMeta)).toHaveLength(2);
  });
});
