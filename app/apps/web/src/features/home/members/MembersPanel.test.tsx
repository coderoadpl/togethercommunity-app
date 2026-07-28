import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { MemberWithProductIds } from '#core/domain/index.js';

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
    deletedAt: null,
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
    deletedAt: null,
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
    deletedAt: null,
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

  it('confirms member removal with grant and progress impact counts', async () => {
    const removed: string[] = [];
    useMembers();
    server.use(
      http.get('/api/members/:memberId/grants', () =>
        HttpResponse.json({
          ok: true,
          data: {
            grants: [
              {
                id: 'grant-1',
                productId: 'p1',
                productName: 'Course one',
                startsAt: '2026-01-01T00:00:00.000Z',
                expiresAt: null,
                source: 'manual',
                active: true,
              },
              {
                id: 'grant-2',
                productId: 'p2',
                productName: 'Course two',
                startsAt: '2026-01-01T00:00:00.000Z',
                expiresAt: null,
                source: 'manual',
                active: true,
              },
            ],
          },
        }),
      ),
      http.get('/api/members/:memberId/learning-summary', () =>
        HttpResponse.json({
          ok: true,
          data: {
            summary: {
              lastActivityAt: null,
              courses: [
                {
                  courseId: 'course-1',
                  courseName: 'Course one',
                  completedLessonCount: 3,
                  accessibleLessonCount: 5,
                  lastActivityAt: null,
                  latestCompletedLesson: null,
                },
                {
                  courseId: 'course-2',
                  courseName: 'Course two',
                  completedLessonCount: 2,
                  accessibleLessonCount: 4,
                  lastActivityAt: null,
                  latestCompletedLesson: null,
                },
              ],
            },
          },
        }),
      ),
      http.delete('/api/members/:memberId', ({ params }) => {
        removed.push(String(params.memberId));
        return HttpResponse.json({ ok: true, data: { memberId: String(params.memberId) } });
      }),
    );

    renderWithProviders(<MembersPanel />);
    const row = (await screen.findAllByTestId('member-row')).find((candidate) =>
      candidate.textContent?.includes('student1@together.dev'),
    );
    expect(row).toBeDefined();
    if (row === undefined) return;

    await userEvent.click(within(row).getByRole('button', { name: pl.members.remove }));

    const dialog = await screen.findByRole('dialog', { name: pl.members.removeConfirmTitle });
    expect(await within(dialog).findByTestId('member-remove-impact')).toHaveTextContent(
      pl.members.removeImpact({ grants: 2, completedLessons: 5 }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: pl.members.remove }));

    await waitFor(() => expect(removed).toEqual(['member-1']));
  });

  it('marks pseudonymized members and hides their remove action', async () => {
    const withDeleted: MemberWithProductIds[] = [
      ...members.slice(0, 1),
      {
        id: 'member-gone',
        email: 'deleted-member-gone@anonymized.invalid',
        displayName: null,
        tags: [],
        marketingConsents: {},
        externalCustomerIds: {},
        createdAt: '2026-07-12T13:00:00.000Z',
        deletedAt: '2026-07-19T09:00:00.000Z',
        productIds: ['p1'],
        activeProductIds: [],
      },
    ];
    server.use(http.get('/api/members', () => HttpResponse.json({ ok: true, data: { members: withDeleted } })));

    renderWithProviders(<MembersPanel />);
    const row = (await screen.findAllByTestId('member-row')).find((candidate) =>
      candidate.textContent?.includes('deleted-member-gone@anonymized.invalid'),
    );
    expect(row).toBeDefined();
    if (row === undefined) return;

    expect(within(row).getByTestId('member-deleted-badge')).toHaveTextContent(pl.members.deletedBadge);
    expect(within(row).queryByRole('button', { name: pl.members.remove })).toBeNull();
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
      deletedAt: null,
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
