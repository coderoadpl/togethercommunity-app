import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { en } from '../../i18n/en.js';
import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { PlatformDataReset } from './PlatformDataReset.js';

const openDialog = async () => {
  const user = userEvent.setup();
  renderWithProviders(<PlatformDataReset environment="staging" />);
  await user.click(screen.getByTestId('platform-reset-open'));
  return user;
};

describe('PlatformDataReset', () => {
  it('keeps the confirm button disabled until the environment name is typed', async () => {
    const user = await openDialog();
    const confirm = screen.getByTestId('platform-reset-confirm');

    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(en.platformReset.confirmLabel), 'production');
    expect(confirm).toBeDisabled();

    await user.clear(screen.getByLabelText(en.platformReset.confirmLabel));
    await user.type(screen.getByLabelText(en.platformReset.confirmLabel), 'staging');
    expect(confirm).toBeEnabled();
  });

  it('reports the reset and shows the success toast', async () => {
    const requests: unknown[] = [];
    server.use(http.post('/api/platform/data-reset', async ({ request }) => {
      requests.push(await request.json());
      return HttpResponse.json({
        ok: true,
        data: { environment: 'staging', durationMs: 1200, wiped: [] },
      });
    }));

    const user = await openDialog();
    await user.type(screen.getByLabelText(en.platformReset.confirmLabel), 'staging');
    await user.click(screen.getByTestId('platform-reset-confirm'));

    expect(await screen.findByText(en.platformReset.success({ environment: 'staging' })))
      .toBeInTheDocument();
    expect(requests).toEqual([{ confirmation: 'staging' }]);
  });

  it('keeps the dialog open and surfaces a refusal', async () => {
    server.use(http.post('/api/platform/data-reset', () => HttpResponse.json(
      { ok: false, error: { code: 'forbidden', message: 'Data reset refused' } },
      { status: 403 },
    )));

    const user = await openDialog();
    await user.type(screen.getByLabelText(en.platformReset.confirmLabel), 'staging');
    await user.click(screen.getByTestId('platform-reset-confirm'));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByText(en.platformReset.success({ environment: 'staging' })))
      .not.toBeInTheDocument();
  });
});
