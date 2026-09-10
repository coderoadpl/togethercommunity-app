import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { ContactSendsSection } from './ContactSendsSection.js';
import { renderDirectory } from './directory-test-helpers.js';
import { server } from '../../../test/server.js';
import { en } from '../../../i18n/en.js';
import { formatDateTime } from '../../../lib/format.js';

const ContactHistory = () => <ContactSendsSection contactId="contact-id" />;

const chipIn = (row: HTMLElement, label: string): Element => {
  const chip = within(row).getByText(label).closest('.MuiChip-root');
  if (chip === null) throw new Error(`Expected chip for ${label}`);
  return chip;
};

describe('contact send history', () => {
  it('requests the contact filter and renders delivery outcomes, fallback status, dates, and skip reasons', async () => {
    let contactId: string | null = null;
    server.use(http.get('/api/marketing/sends', ({ request }) => {
      contactId = new URL(request.url).searchParams.get('contactId');
      return HttpResponse.json({
        ok: true,
        data: {
          sends: [
            { id: 'delivered-send', tenantId: 'tenant-studio', kind: 'marketing', recipient: 'contact@example.test', subject: 'Delivered campaign with a long subject that still needs to wrap cleanly on narrow screens', source: 'broadcast', sourceApp: null, status: 'sent', skipReason: null, failureCode: null, failureMessage: null, deliveryStatus: 'delivered', deliveryOccurredAt: '2026-09-09T11:30:00.000Z', campaignId: 'campaign', campaignName: 'Campaign', contactId: 'contact-id', sesMessageId: null, transport: 'tenant-ses', createdAt: '2026-09-09T11:00:00.000Z', sentAt: '2026-09-09T11:05:00.000Z' },
            { id: 'bounced-send', tenantId: 'tenant-studio', kind: 'marketing', recipient: 'contact@example.test', subject: 'Bounced campaign', source: 'broadcast', sourceApp: null, status: 'sent', skipReason: null, failureCode: null, failureMessage: null, deliveryStatus: 'bounced', deliveryOccurredAt: '2026-09-09T10:30:00.000Z', campaignId: 'campaign', campaignName: 'Campaign', contactId: 'contact-id', sesMessageId: null, transport: 'tenant-ses', createdAt: '2026-09-09T10:00:00.000Z', sentAt: '2026-09-09T10:05:00.000Z' },
            { id: 'complained-send', tenantId: 'tenant-studio', kind: 'marketing', recipient: 'contact@example.test', subject: 'Complained campaign', source: 'broadcast', sourceApp: null, status: 'sent', skipReason: null, failureCode: null, failureMessage: null, deliveryStatus: 'complained', deliveryOccurredAt: '2026-09-09T09:30:00.000Z', campaignId: 'campaign', campaignName: 'Campaign', contactId: 'contact-id', sesMessageId: null, transport: 'tenant-ses', createdAt: '2026-09-09T09:00:00.000Z', sentAt: '2026-09-09T09:05:00.000Z' },
            { id: 'sent-without-delivery-send', tenantId: 'tenant-studio', kind: 'marketing', recipient: 'contact@example.test', subject: 'Sent without delivery event', source: 'broadcast', sourceApp: null, status: 'sent', skipReason: null, failureCode: null, failureMessage: null, deliveryStatus: null, deliveryOccurredAt: null, campaignId: 'campaign', campaignName: 'Campaign', contactId: 'contact-id', sesMessageId: null, transport: 'tenant-ses', createdAt: '2026-09-08T11:00:00.000Z', sentAt: null },
            { id: 'skipped-send', tenantId: 'tenant-studio', kind: 'marketing', recipient: 'contact@example.test', subject: 'Skipped campaign', source: 'broadcast', sourceApp: null, status: 'skipped', skipReason: 'suppressed', failureCode: null, failureMessage: null, deliveryStatus: null, deliveryOccurredAt: null, campaignId: 'campaign', campaignName: 'Campaign', contactId: 'contact-id', sesMessageId: null, transport: 'tenant-ses', createdAt: '2026-09-08T10:00:00.000Z', sentAt: null },
          ],
          nextCursor: null,
        },
      });
    }));
    await renderDirectory(ContactHistory, '/panel/marketing/contacts/contact-id');
    expect(await screen.findByRole('link', { name: 'Skipped campaign' })).toHaveAttribute('href', '/panel/marketing/sends/marketing/skipped-send');
    expect(contactId).toBe('contact-id');

    const rows = await screen.findAllByTestId('contact-send-row');
    expect(rows).toHaveLength(5);
    const [deliveredRow, bouncedRow, complainedRow, sentWithoutDeliveryRow, skippedRow] = rows;
    if (deliveredRow === undefined || bouncedRow === undefined || complainedRow === undefined || sentWithoutDeliveryRow === undefined || skippedRow === undefined) throw new Error('Expected contact send rows');
    expect(deliveredRow).toHaveStyle({ flexWrap: 'wrap' });
    expect(within(deliveredRow).getByRole('link', { name: 'Delivered campaign with a long subject that still needs to wrap cleanly on narrow screens' })).toHaveAttribute('href', '/panel/marketing/sends/marketing/delivered-send');
    expect(chipIn(deliveredRow, en.marketing.deliveryDelivered)).toHaveClass('MuiChip-colorSuccess');
    expect(within(deliveredRow).getByText(formatDateTime('2026-09-09T11:05:00.000Z', 'en'))).toBeInTheDocument();

    expect(within(bouncedRow).getByRole('link', { name: 'Bounced campaign' })).toHaveAttribute('href', '/panel/marketing/sends/marketing/bounced-send');
    expect(chipIn(bouncedRow, en.marketing.deliveryBounced)).toHaveClass('MuiChip-colorError');
    expect(within(bouncedRow).queryByText(en.marketing.statusSent)).not.toBeInTheDocument();
    expect(within(bouncedRow).getByText(formatDateTime('2026-09-09T10:05:00.000Z', 'en'))).toBeInTheDocument();

    expect(chipIn(complainedRow, en.marketing.deliveryComplained)).toHaveClass('MuiChip-colorWarning');
    expect(within(complainedRow).getByText(formatDateTime('2026-09-09T09:05:00.000Z', 'en'))).toBeInTheDocument();

    expect(chipIn(sentWithoutDeliveryRow, en.marketing.statusSent)).toHaveClass('MuiChip-outlined');
    expect(within(sentWithoutDeliveryRow).queryByText(en.marketing.deliveryDelivered)).not.toBeInTheDocument();
    expect(within(sentWithoutDeliveryRow).getByText(formatDateTime('2026-09-08T11:00:00.000Z', 'en'))).toBeInTheDocument();

    expect(chipIn(skippedRow, en.marketing.statusSkipped)).toHaveClass('MuiChip-outlined');
    expect(within(skippedRow).getByText(formatDateTime('2026-09-08T10:00:00.000Z', 'en'))).toBeInTheDocument();
    expect(within(skippedRow).getByText(`${en.marketing.skipReason}: ${en.marketing.skipReasons.suppressed}`)).toBeInTheDocument();
    expect(screen.queryByText(en.marketing.notSent)).not.toBeInTheDocument();
  });
  it('shows empty history without suggesting that a contact has received a campaign', async () => {
    server.use(http.get('/api/marketing/sends', () => HttpResponse.json({ ok: true, data: { sends: [], nextCursor: null } })));
    await renderDirectory(ContactHistory, '/panel/marketing/contacts/contact-id');
    expect(await screen.findByText(en.directory.noHistory)).toBeInTheDocument();
  });
});
