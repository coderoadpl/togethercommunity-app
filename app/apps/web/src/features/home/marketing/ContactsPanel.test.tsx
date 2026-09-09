import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { marketingDirectoryContracts } from '#core/client/index.js';
import { actions } from '../../../api.js';
import { directoryTestFixtures } from './directory-test-data.js';
import { pl } from '../../../i18n/pl.js';
import { fixtureValue, installDirectoryFixture, renderDirectory } from './directory-test-helpers.js';
import { server } from '../../../test/server.js';
import { ContactsPanel } from './ContactsPanel.js';


const fixture = directoryTestFixtures['panel-marketing-contacts'];

const page = marketingDirectoryContracts.listMarketingContacts.output.parse(fixtureValue(fixture, 'listMarketingContacts'));
describe('marketing contacts', () => {
  it('returns from page four to page three and resets history with filters', async () => {
    installDirectoryFixture(fixture);
    const cursors: (string | null)[] = [];
    server.use(http.get('/api/marketing/contacts', ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('cursor');
      cursors.push(cursor);
      return HttpResponse.json({ ok: true, data: { ...page, nextCursor: String(Number(cursor ?? 1) + 1) } });
    }));
    await renderDirectory(ContactsPanel, '/panel/marketing/contacts');
    for (const cursor of ['2', '3', '4']) {
      await userEvent.click(await screen.findByRole('button', { name: pl.directory.next }));
      await waitFor(() => expect(cursors.at(-1)).toBe(cursor));
    }
    await userEvent.click(screen.getByRole('button', { name: pl.directory.back }));
    await waitFor(() => expect(cursors.at(-1)).toBe('3'));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Anna' } });
    await waitFor(() => expect(cursors.at(-1)).toBeNull());
    expect(screen.queryByRole('button', { name: pl.directory.back })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: pl.directory.next }));
    await waitFor(() => expect(cursors.at(-1)).toBe('2'));
    await userEvent.click(screen.getByRole('button', { name: pl.directory.back }));
    await waitFor(() => expect(cursors.at(-1)).toBeNull());
  });
  it('filters independently by definition and suppression, and resets the cursor on search', async () => {
    installDirectoryFixture(fixture);
    const requests: URL[] = [];
    server.use(http.get('/api/marketing/contacts', ({ request }) => { requests.push(new URL(request.url)); return HttpResponse.json({ ok: true, data: { ...page, nextCursor: 'next-page' } }); }));
    await renderDirectory(ContactsPanel, '/panel/marketing/contacts');
    const row = await screen.findByRole('row', { name: /Blocked Contact/ });
    expect(within(row).getByText(`${pl.directory.suppressed}: ${pl.directory.unsubscribe}`)).toBeInTheDocument();
    expect(within(row).getByText(pl.directory.noAccount)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: pl.directory.next }));
    await waitFor(() => expect(requests.at(-1)?.searchParams.get('cursor')).toBe('next-page'));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Anna' } });
    await waitFor(() => expect(requests.at(-1)?.searchParams.get('search')).toBe('Anna'));
    expect(requests.at(-1)?.searchParams.has('cursor')).toBe(false);
    await userEvent.click(screen.getByRole('combobox', { name: pl.directory.suppression }));
    await userEvent.click(screen.getByRole('option', { name: pl.directory.notSuppressed }));
    await waitFor(() => expect(requests.at(-1)?.searchParams.get('suppressed')).toBe('false'));
    expect(requests.at(-1)?.searchParams.has('consentDefinitionId')).toBe(false);
  });

  it('archives a contact and invalidates only the current tenant directory', async () => {
    installDirectoryFixture(fixture);
    const contact = page.contacts.find((item) => item.email === 'anna@example.org');
    if (!contact) throw new Error('Missing fixture contact');
    let archived = false;
    server.use(
      http.get('/api/marketing/contacts', () => HttpResponse.json({ ok: true, data: { ...page, contacts: page.contacts.filter((item) => !archived || item.id !== contact.id) } })),
      http.post('/api/marketing/contacts/:id/archive', () => {
        archived = true;
        return HttpResponse.json({ ok: true, data: { contact: { ...contact, archivedAt: '2026-07-02T10:00:00.000Z' } } });
      }),
    );
    const { queryClient } = await renderDirectory(ContactsPanel, '/panel/marketing/contacts');
    const otherTenantQuery = actions.directory.contacts('other-tenant', { limit: 50, archived: false });
    queryClient.setQueryDefaults(otherTenantQuery.queryKey, { gcTime: Infinity });
    queryClient.setQueryData(otherTenantQuery.queryKey, page);
    const row = await screen.findByRole('row', { name: /Anna Example/ });
    await userEvent.click(within(row).getByRole('button', { name: pl.directory.archive }));
    await waitFor(() => expect(screen.queryByRole('row', { name: /Anna Example/ })).not.toBeInTheDocument());
    expect(queryClient.getQueryState(otherTenantQuery.queryKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryData(otherTenantQuery.queryKey)).toEqual(page);
  });
});
