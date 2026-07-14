import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { TenantSecretMasked } from '@core/domain/index.js';

import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { IntegrationsPanel } from './IntegrationsPanel.js';

const renderPanel = (initial: TenantSecretMasked[] = []) => {
  let secrets = [...initial];

  server.use(
    http.get('/api/tenant-secrets', () => HttpResponse.json({ ok: true, data: { secrets } })),
    http.post('/api/tenant-secrets', async ({ request }) => {
      const body = await request.json();
      const key = typeof body === 'object' && body !== null && 'key' in body ? String(body.key) : '';
      const secret: TenantSecretMasked = {
        key: key === 'stripe.webhookSecret' ? 'stripe.webhookSecret' : 'stripe.restrictedKey',
        maskedPreview: '••••2345',
        updatedAt: '2026-07-12T10:00:00.000Z',
      };
      secrets = [...secrets.filter((s) => s.key !== secret.key), secret];
      return HttpResponse.json({ ok: true, data: { secret } });
    }),
    http.delete('/api/tenant-secrets/:key', ({ params }) => {
      secrets = secrets.filter((s) => s.key !== params.key);
      return HttpResponse.json({ ok: true, data: { key: params.key } });
    }),
    http.post('/api/integrations/stripe/test', () =>
      HttpResponse.json({ ok: true, data: { ok: true, diagnostic: 'Stripe accepted the credentials.' } }),
    ),
  );

  return renderWithProviders(<IntegrationsPanel tenantId="tenant-123" />);
};

describe('IntegrationsPanel', () => {
  it('shows the per-tenant webhook URL to paste into Stripe', async () => {
    renderPanel();
    const url = await screen.findByTestId('stripe-webhook-url');
    expect(url).toHaveValue(`${window.location.origin}/api/webhooks/stripe/tenant-123`);
    expect(screen.getByText(pl.integrations.webhookUrlHint)).toBeInTheDocument();
  });

  it('saves the restricted key and then shows a masked, configured status', async () => {
    renderPanel();

    const status = await screen.findByTestId('secret-status-stripe.restrictedKey');
    expect(status).toHaveTextContent(pl.integrations.notConfigured);

    await userEvent.type(screen.getByTestId('secret-input-stripe.restrictedKey'), 'rk_live_secret2345');
    await userEvent.click(screen.getByTestId('secret-save-stripe.restrictedKey'));

    expect(await screen.findByTestId('secret-saved-stripe.restrictedKey')).toHaveTextContent(
      pl.integrations.saved,
    );
    await waitFor(() => {
      expect(screen.getByTestId('secret-status-stripe.restrictedKey')).toHaveTextContent(
        pl.integrations.configured,
      );
    });
    expect(screen.getByTestId('secret-status-stripe.restrictedKey')).toHaveTextContent('••••2345');
  });

  it('reports a readable diagnostic after testing the connection', async () => {
    renderPanel();
    await userEvent.click(await screen.findByTestId('stripe-test-connection'));
    expect(await screen.findByTestId('stripe-test-result')).toHaveTextContent(
      'Stripe accepted the credentials.',
    );
  });

  it('removes a configured secret', async () => {
    renderPanel([
      { key: 'stripe.restrictedKey', maskedPreview: '••••2345', updatedAt: '2026-07-12T10:00:00.000Z' },
    ]);

    const field = (await screen.findByTestId('secret-input-stripe.restrictedKey')).closest('form');
    expect(field).not.toBeNull();
    if (!field) return;
    await userEvent.click(within(field).getByTestId('secret-remove-stripe.restrictedKey'));

    await waitFor(() => {
      expect(screen.getByTestId('secret-status-stripe.restrictedKey')).toHaveTextContent(
        pl.integrations.notConfigured,
      );
    });
  });
});
