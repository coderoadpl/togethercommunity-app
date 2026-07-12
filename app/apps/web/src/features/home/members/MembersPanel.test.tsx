import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { MemberWithProductIds } from '@core/domain/index.js';

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
  },
];

describe('MembersPanel', () => {
  it('renders the members table with emails and product counts', async () => {
    server.use(http.get('/api/members', () => HttpResponse.json({ ok: true, data: { members } })));

    renderWithProviders(<MembersPanel />);

    expect(await screen.findByText('student1@together.dev')).toBeInTheDocument();
    expect(screen.getByText('Student One')).toBeInTheDocument();
    expect(screen.getByText('student2@together.dev')).toBeInTheDocument();

    const rows = screen.getAllByTestId('member-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('2');
    expect(rows[1]).toHaveTextContent('0');
  });
});
