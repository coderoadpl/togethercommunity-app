import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { marketingDirectoryContracts } from '#core/client/index.js';
import { directoryTestFixtures } from './directory-test-data.js';
import { pl } from '../../../i18n/pl.js';
import { fixtureValue, installDirectoryFixture, renderDirectory } from './directory-test-helpers.js';
import { server } from '../../../test/server.js';
import { ContactDetailPanel } from './ContactDetailPanel.js';

const fixture = directoryTestFixtures['panel-marketing-contact-detail'];

const detail = marketingDirectoryContracts.getMarketingContact.output.parse(fixtureValue(fixture, 'getMarketingContact'));
describe('contact detail', () => {
  it('edits names and tags without changing address identity and links import history', async () => {
    installDirectoryFixture(fixture);
    let updated: unknown;
    const projectionRequests: URL[] = [];
    server.use(http.get('/api/marketing/contacts', ({ request }) => { projectionRequests.push(new URL(request.url)); return HttpResponse.json({ ok: true, data: fixtureValue(fixture, 'listMarketingContacts') }); }));
    server.use(http.get('/api/marketing/contacts/:id', () => HttpResponse.json({ ok: true, data: { ...detail, events: detail.events.map((event) => ({ ...event, importId: 'import-contacts' })) } }))); 
    server.use(http.post('/api/marketing/contacts/:id/update', async ({ request }) => { updated = await request.json(); return HttpResponse.json({ ok: true, data: { contact: detail.contact } }); }));
    await renderDirectory(ContactDetailPanel, '/panel/marketing/contacts/$contactId', fixture.route);
    fireEvent.change(await screen.findByLabelText(pl.directory.firstName), { target: { value: 'Anna' } });
    fireEvent.change(screen.getByLabelText(pl.directory.tags), { target: { value: 'launch|news' } });
    await userEvent.click(screen.getByRole('button', { name: pl.directory.save }));
    await waitFor(() => expect(updated).toMatchObject({ contactId: detail.contact.id, firstName: 'Anna', tags: ['launch', 'news'] }));
    expect(updated).not.toHaveProperty('email');
    expect(projectionRequests.length).toBeGreaterThan(0);
    expect(projectionRequests.every((url) => url.searchParams.get('id') === detail.contact.id && !url.searchParams.has('search'))).toBe(true);
    expect(screen.getByText(pl.directory.evidenceHint)).toBeInTheDocument();
    expect(screen.getAllByRole('link').some((link) => link.getAttribute('href')?.includes('importId=import-contacts'))).toBe(true);
  });
});
