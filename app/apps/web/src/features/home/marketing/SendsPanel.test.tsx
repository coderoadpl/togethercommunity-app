import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { SendsPanel } from './SendsPanel.js';

describe('sends panel scheduler run filter', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('loads a linked run filter and can clear it', async () => {
    const requests: string[] = [];
    server.use(
      http.get('/api/marketing/campaigns', () =>
        HttpResponse.json({ ok: true, data: { campaigns: [] } })),
      http.get('/api/marketing/sends', ({ request }) => {
        requests.push(request.url);
        return HttpResponse.json({ ok: true, data: { sends: [], nextCursor: null } });
      }),
    );
    window.history.replaceState(null, '', '/panel/marketing/sends?runId=run-linked');

    renderWithProviders(<SendsPanel />);

    expect(await screen.findByLabelText('ID uruchomienia harmonogramu')).toHaveValue('run-linked');
    await waitFor(() => {
      expect(requests.some((request) => new URL(request).searchParams.get('runId') === 'run-linked')).toBe(true);
    });

    await userEvent.click(screen.getByRole('button', { name: 'Wyczyść filtr uruchomienia' }));

    await waitFor(() => {
      expect(requests.some((request) => !new URL(request).searchParams.has('runId'))).toBe(true);
    });
  });
});
