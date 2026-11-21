import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { actions } from './api.js';
import { refreshForNotificationKind, useChangeProposalSummary } from './notifications-data.js';
import { streamlessPollInterval } from './notifications-stream.js';
import { renderWithProviders } from './test/render.js';
import { server } from './test/server.js';

const SummaryProbe = () => {
  const summary = useChangeProposalSummary(true);
  return <span data-testid="pending">{summary.data?.pending ?? '-'}</span>;
};

const summaryKey = actions.changeProposalSummary.queryKey;
const pendingKey = actions.changeProposalPages({ status: 'pending', limit: 100 }).queryKey;

const serveSummary = () => {
  const state = { pending: 1 };
  server.use(http.get('/api/change-proposals/summary', () =>
    HttpResponse.json({ ok: true, data: { pending: state.pending, pendingGroups: 0, hasProposals: true } })));
  return state;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('realtime notification refresh', () => {
  it('refreshes the pending proposal summary and lists on a change proposal notification only', async () => {
    const { queryClient } = renderWithProviders(<div />);
    queryClient.setQueryData(summaryKey, { pending: 0, pendingGroups: 0, hasProposals: false });
    queryClient.setQueryData(pendingKey, { pages: [], pageParams: [] });

    await refreshForNotificationKind(queryClient, 'thread-reply');
    expect(queryClient.getQueryState(summaryKey)?.isInvalidated).toBe(false);

    await refreshForNotificationKind(queryClient, 'change-proposal');
    expect(queryClient.getQueryState(summaryKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(pendingKey)?.isInvalidated).toBe(true);
  });
});

describe('the pending proposal summary', () => {
  it('polls the summary without the stream and reloads the proposal lists when the polled count changes', async () => {
    const served = serveSummary();
    const { queryClient } = renderWithProviders(<SummaryProbe />);
    expect(await screen.findByText('1')).toBeInTheDocument();
    queryClient.setQueryDefaults(pendingKey, { gcTime: Infinity });
    queryClient.setQueryData(pendingKey, { pages: [], pageParams: [] });
    const observer = queryClient.getQueryCache().find({ queryKey: summaryKey })?.observers[0];
    expect(observer?.options.refetchInterval).toBe(streamlessPollInterval(true));

    await queryClient.refetchQueries({ queryKey: summaryKey });
    expect(queryClient.getQueryState(pendingKey)?.isInvalidated).toBe(false);

    served.pending = 2;
    await queryClient.refetchQueries({ queryKey: summaryKey });
    expect(await screen.findByText('2')).toBeInTheDocument();
    await waitFor(() => expect(queryClient.getQueryState(pendingKey)?.isInvalidated).toBe(true));
    expect(queryClient.getQueryState(summaryKey)?.isInvalidated).toBe(false);
  });

  it('leaves the refresh to the stream while it is connected', async () => {
    vi.stubGlobal('EventSource', class { readonly readyState = 0; });
    const served = serveSummary();
    const { queryClient } = renderWithProviders(<SummaryProbe />);
    expect(await screen.findByText('1')).toBeInTheDocument();
    queryClient.setQueryDefaults(pendingKey, { gcTime: Infinity });
    queryClient.setQueryData(pendingKey, { pages: [], pageParams: [] });
    expect(queryClient.getQueryCache().find({ queryKey: summaryKey })?.observers[0]?.options.refetchInterval).toBe(false);

    served.pending = 2;
    await queryClient.refetchQueries({ queryKey: summaryKey });
    expect(await screen.findByText('2')).toBeInTheDocument();
    expect(queryClient.getQueryState(pendingKey)?.isInvalidated).toBe(false);
  });
});
