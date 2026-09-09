import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { ContactSendsSection } from './ContactSendsSection.js';
import { renderDirectory } from './directory-test-helpers.js';
import { server } from '../../../test/server.js';
import { pl } from '../../../i18n/pl.js';

const ContactHistory = () => <ContactSendsSection contactId="contact-id" />;
describe('contact send history', () => {
  it('requests the contact filter and links skipped sends to the existing journal', async () => {
    let contactId: string | null = null;
    server.use(http.get('/api/marketing/sends', ({ request }) => {
      contactId = new URL(request.url).searchParams.get('contactId');
      return HttpResponse.json({ ok: true, data: { sends: [{ id: 'send', tenantId: 'tenant-studio', kind: 'marketing', recipient: 'contact@example.test', subject: 'Contact campaign', source: 'broadcast', sourceApp: null, status: 'skipped', skipReason: 'suppressed', failureCode: null, failureMessage: null, deliveryStatus: null, deliveryOccurredAt: null, campaignId: 'campaign', campaignName: 'Campaign', contactId: 'contact-id', sesMessageId: null, transport: 'tenant-ses', createdAt: '2026-09-09T10:00:00.000Z', sentAt: null }], nextCursor: null } });
    }));
    await renderDirectory(ContactHistory, '/panel/marketing/contacts/contact-id');
    expect(await screen.findByRole('link', { name: 'Contact campaign' })).toHaveAttribute('href', '/panel/marketing/sends/marketing/send');
    expect(contactId).toBe('contact-id');
    expect(screen.getByText(/suppressed/)).toBeInTheDocument();
  });
  it('shows empty history without suggesting that a contact has received a campaign', async () => {
    server.use(http.get('/api/marketing/sends', () => HttpResponse.json({ ok: true, data: { sends: [], nextCursor: null } })));
    await renderDirectory(ContactHistory, '/panel/marketing/contacts/contact-id');
    expect(await screen.findByText(pl.directory.noHistory)).toBeInTheDocument();
  });
});
