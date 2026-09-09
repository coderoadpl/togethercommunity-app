import { useState } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { ContactCampaignAudience } from '#core/domain/index.js';
import { CampaignAudienceSection } from './CampaignAudienceSection.js';
import { renderDirectory } from './directory-test-helpers.js';
import { server } from '../../../test/server.js';
import { en } from '../../../i18n/en.js';

const empty: ContactCampaignAudience = { version: 2, includeLists: [], excludeLists: [], excludeProductIds: [], includeMembersWithConsent: false };
const Interactive = () => {
  const [audience, setAudience] = useState(empty);
  return <CampaignAudienceSection audience={audience} onChange={setAudience} consentDefinitionId="consent" disabled={false} frozen={false} />;
};
const list = { id: 'list', tenantId: 'tenant-studio', key: 'newsletter', name: 'Newsletter', kind: 'static', rule: null, revision: 1, createdAt: '2026-09-09T10:00:00.000Z', updatedAt: '2026-09-09T10:00:00.000Z', archivedAt: null };
const install = () => server.use(http.get('/api/marketing/lists', () => HttpResponse.json({ ok: true, data: { lists: [list], nextCursor: null } })), http.get('/api/products', () => HttpResponse.json({ ok: true, data: { products: [] } })));
describe('campaign audience controls', () => {
  it('starts empty, previews eligible contacts and sends include and exclude lists independently', async () => {
    install();
    const requests: unknown[] = [];
    server.use(http.post('/api/marketing/audience-preview', async ({ request }) => {
      requests.push(await request.json());
      return HttpResponse.json({ ok: true, data: { count: 1, candidateCount: 2, excludedCount: 0, skipped: { suppressed: 1, withdrawn: 0, pendingConfirmation: 0, noConsent: 0 }, sample: [{ contactId: 'contact', email: 'eligible@example.test', displayName: null, memberId: null }], computedAt: '2026-09-09T10:00:00.000Z', audienceHash: 'hash' } });
    }));
    await renderDirectory(Interactive, '/panel/marketing/campaigns/new');
    expect(await screen.findByRole('checkbox', { name: en.marketing.includeConsentedMembers })).not.toBeChecked();
    expect(await screen.findByText('eligible@example.test')).toBeInTheDocument();
    expect(requests[0]).toMatchObject({ audience: empty });
    await userEvent.click(screen.getByRole('combobox', { name: en.marketing.includeLists }));
    await userEvent.click(await screen.findByRole('option', { name: 'Newsletter (newsletter)' }));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(requests.at(-1)).toMatchObject({ audience: { includeLists: ['list'], excludeLists: [] } }));
    await userEvent.click(screen.getByRole('combobox', { name: en.marketing.excludeLists }));
    await userEvent.click(await screen.findByRole('option', { name: 'Newsletter (newsletter)' }));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(requests.at(-1)).toMatchObject({ audience: { includeLists: ['list'], excludeLists: ['list'] } }));
  });
  it('disables changes and clearly labels a frozen audience without recomputing it', async () => {
    install();
    let previews = 0;
    server.use(http.post('/api/marketing/audience-preview', () => { previews += 1; return HttpResponse.json({ ok: true, data: { count: 0 } }); }));
    const Frozen = () => <CampaignAudienceSection audience={empty} onChange={() => { throw new Error('Frozen audience changed'); }} consentDefinitionId="consent" disabled frozen />;
    await renderDirectory(Frozen, '/panel/marketing/campaigns/frozen');
    expect(await screen.findByText(en.marketing.frozenAudience)).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.queryByRole('button', { name: en.marketing.previewContacts })).not.toBeInTheDocument();
    expect(previews).toBe(0);
  });
});
