import { describe, expect, it } from 'vitest';

import { actions } from './api.js';
import { refreshForNotificationKind } from './notifications-data.js';
import { renderWithProviders } from './test/render.js';

describe('realtime notification refresh', () => {
  it('refreshes the pending proposal summary and lists on a change proposal notification only', async () => {
    const { queryClient } = renderWithProviders(<div />);
    const summary = actions.changeProposalSummary.queryKey;
    const pending = actions.changeProposalPages({ status: 'pending', limit: 100 }).queryKey;
    queryClient.setQueryData(summary, { pending: 0, pendingGroups: 0 });
    queryClient.setQueryData(pending, { pages: [], pageParams: [] });

    await refreshForNotificationKind(queryClient, 'thread-reply');
    expect(queryClient.getQueryState(summary)?.isInvalidated).toBe(false);

    await refreshForNotificationKind(queryClient, 'change-proposal');
    expect(queryClient.getQueryState(summary)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(pending)?.isInvalidated).toBe(true);
  });
});
