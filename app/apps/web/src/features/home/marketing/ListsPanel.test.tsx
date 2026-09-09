import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { marketingDirectoryContracts } from '#core/client/index.js';
import { directoryTestFixtures } from './directory-test-data.js';
import { en } from '../../../i18n/en.js';
import { fixtureValue, installDirectoryFixture, renderDirectory } from './directory-test-helpers.js';
import { server } from '../../../test/server.js';
import { ListsPanel } from './ListsPanel.js';
import { ListDetailPanel } from './ListDetailPanel.js';


const staticFixture = directoryTestFixtures['panel-marketing-list-static'];
const dynamicFixture = directoryTestFixtures['panel-marketing-list-dynamic'];

const detail = marketingDirectoryContracts.getMarketingList.output.parse(fixtureValue(staticFixture, 'getMarketingList'));
describe('marketing list management', () => {
  it('loads counts only for the requested list', async () => {
    installDirectoryFixture(staticFixture);
    const ids: string[] = [];
    server.use(http.get('/api/marketing/lists/:id', ({ params }) => { ids.push(String(params['id'])); return HttpResponse.json({ ok: true, data: detail }); }));
    await renderDirectory(ListsPanel, '/panel/marketing/lists');
    const buttons = await screen.findAllByRole('button', { name: en.directory.loadCounts });
    expect(ids).toEqual([]);
    const button = buttons[0];
    if (!button) throw new Error('Missing counts button');
    await userEvent.click(button);
    await waitFor(() => expect(ids).toEqual([detail.list.id]));
    expect(screen.getAllByRole('button', { name: en.directory.loadCounts })).toHaveLength(1);
  });
  it('uses revisions for updates and keeps key and kind immutable', async () => {
    installDirectoryFixture(staticFixture);
    let body: unknown;
    server.use(http.post('/api/marketing/lists/:id/update', async ({ request }) => { body = await request.json(); return HttpResponse.json({ ok: true, data: { list: { ...detail.list, name: 'Renamed', revision: 2 } } }); }));
    await renderDirectory(ListDetailPanel, '/panel/marketing/lists/$listId', staticFixture.route);
    expect(await screen.findByLabelText(en.directory.key)).toBeDisabled();
    expect(screen.getByRole('combobox', { name: en.directory.kind })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.change(screen.getByLabelText(en.directory.name), { target: { value: 'Renamed' } });
    await userEvent.click(screen.getByRole('button', { name: en.directory.save }));
    await waitFor(() => expect(body).toEqual({ listId: detail.list.id, expectedRevision: detail.list.revision, name: 'Renamed' }));
  });
  it('shows live dynamic rules and counts without manual membership controls', async () => {
    installDirectoryFixture(dynamicFixture);
    await renderDirectory(ListDetailPanel, '/panel/marketing/lists/$listId', dynamicFixture.route);
    expect(await screen.findByRole('combobox', { name: en.directory.rule })).toHaveTextContent(en.directory.tagRule);
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.directory.remove })).not.toBeInTheDocument();
    expect(await screen.findByText(new RegExp(`${en.directory.contactCount}: 2`))).toBeInTheDocument();
  });
});
