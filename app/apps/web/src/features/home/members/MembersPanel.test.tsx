import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { MemberWithProductIds } from '@core/domain/index.js';

import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { MembersPanel } from './MembersPanel.js';

const members: MemberWithProductIds[] = [
  {
    id: 'member-1',
    email: 'student1@together.dev',
    displayName: 'Student One',
    tags: [],
    marketingConsents: {},
    externalCustomerIds: {},
    createdAt: '2026-07-12T10:00:00.000Z',
    productIds: ['p1', 'p2'],
    activeProductIds: ['p1'],
  },
  {
    id: 'member-2',
    email: 'student2@together.dev',
    displayName: null,
    tags: [],
    marketingConsents: {},
    externalCustomerIds: {},
    createdAt: '2026-07-12T11:00:00.000Z',
    productIds: [],
    activeProductIds: [],
  },
  {
    id: 'member-3',
    email: 'expired@together.dev',
    displayName: 'Expired Grants',
    tags: [],
    marketingConsents: {},
    externalCustomerIds: {},
    createdAt: '2026-07-12T12:00:00.000Z',
    productIds: ['p3'],
    activeProductIds: [],
  },
];

const useMembers = () =>
  server.use(http.get('/api/members', () => HttpResponse.json({ ok: true, data: { members } })));

describe('MembersPanel', () => {
  it('renders the members table newest-first with emails and product counts', async () => {
    useMembers();

    renderWithProviders(<MembersPanel />);

    expect(await screen.findByText('student1@together.dev')).toBeInTheDocument();
    expect(screen.getByText('Student One')).toBeInTheDocument();
    expect(screen.getByText('student2@together.dev')).toBeInTheDocument();

    const rows = screen.getAllByTestId('member-row');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('expired@together.dev');
    expect(rows[2]).toHaveTextContent('student1@together.dev');
  });

  it('filters members by email or display name through the search box', async () => {
    useMembers();

    renderWithProviders(<MembersPanel />);
    await screen.findByText('student1@together.dev');

    await userEvent.type(screen.getByTestId('members-search'), 'Student One');

    await waitFor(() => expect(screen.getAllByTestId('member-row')).toHaveLength(1));
    expect(screen.getByText('student1@together.dev')).toBeInTheDocument();

    await userEvent.clear(screen.getByTestId('members-search'));
    await userEvent.type(screen.getByTestId('members-search'), 'nobody-matches');

    expect(await screen.findByText(pl.members.noMatches)).toBeInTheDocument();
  });

  it('filters members by active and expired grants', async () => {
    useMembers();

    renderWithProviders(<MembersPanel />);
    await screen.findByText('student1@together.dev');

    await userEvent.click(screen.getByTestId('members-grant-filter-active'));
    await waitFor(() => expect(screen.getAllByTestId('member-row')).toHaveLength(1));
    expect(screen.getByText('student1@together.dev')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('members-grant-filter-expired'));
    await waitFor(() => expect(screen.getAllByTestId('member-row')).toHaveLength(1));
    expect(screen.getByText('expired@together.dev')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('members-grant-filter-all'));
    await waitFor(() => expect(screen.getAllByTestId('member-row')).toHaveLength(3));
  });

  it('paginates long member lists and searches across all pages', async () => {
    const manyMembers: MemberWithProductIds[] = Array.from({ length: 30 }, (_, index) => ({
      id: `member-page-${index}`,
      email: `member${String(index).padStart(2, '0')}@together.dev`,
      displayName: null,
      tags: [],
      marketingConsents: {},
      externalCustomerIds: {},
      createdAt: new Date(Date.UTC(2026, 5, 1, 0, index)).toISOString(),
      productIds: [],
      activeProductIds: [],
    }));
    server.use(http.get('/api/members', () => HttpResponse.json({ ok: true, data: { members: manyMembers } })));

    renderWithProviders(<MembersPanel />);
    await screen.findByText('member29@together.dev');

    expect(screen.getAllByTestId('member-row')).toHaveLength(25);
    expect(screen.getByTestId('members-pagination')).toHaveTextContent(
      pl.pagination.displayedRows({ from: 1, to: 25, count: 30 }),
    );

    await userEvent.click(screen.getByRole('button', { name: pl.pagination.nextPage }));
    expect(screen.getAllByTestId('member-row')).toHaveLength(5);
    expect(screen.getByText('member00@together.dev')).toBeInTheDocument();

    await userEvent.type(screen.getByTestId('members-search'), 'member29');
    await waitFor(() => expect(screen.getAllByTestId('member-row')).toHaveLength(1));
    expect(screen.getByText('member29@together.dev')).toBeInTheDocument();
  });
});
