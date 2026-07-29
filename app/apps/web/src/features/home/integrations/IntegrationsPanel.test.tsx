import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { TenantSecretMasked } from '#core/domain/index.js';

import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { IntegrationsPanel } from './IntegrationsPanel.js';

interface TestSettings {
  billingPortalUrl: string | null;
  bunnyStreamLibraryId: string | null;
}

const renderPanel = (
  initial: TenantSecretMasked[] = [],
  initialSettings: TestSettings = { billingPortalUrl: null, bunnyStreamLibraryId: null },
) => {
  let secrets = [...initial];
  let settings = { ...initialSettings };

  server.use(
    http.get('/api/tenant-secrets', () => HttpResponse.json({ ok: true, data: { secrets } })),
    http.post('/api/tenant-secrets', async ({ request }) => {
      const body = await request.json();
      const key = typeof body === 'object' && body !== null && 'key' in body ? String(body.key) : '';
      const secret: TenantSecretMasked = {
        key:
          key === 'stripe.webhookSecret' ||
          key === 'bunny.apiKey' ||
          key === 'bunny.securityKey' ||
          key === 'ifirma.invoiceApiKey' ||
          key === 'ifirma.username'
            ? key
            : 'stripe.restrictedKey',
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
    http.get('/api/tenant/settings', () => HttpResponse.json({ ok: true, data: { settings } })),
    http.post('/api/tenant/settings', async ({ request }) => {
      const body = await request.json();
      if (typeof body === 'object' && body !== null && 'bunnyStreamLibraryId' in body) {
        settings = { ...settings, bunnyStreamLibraryId: body.bunnyStreamLibraryId === null ? null : String(body.bunnyStreamLibraryId) };
      }
      return HttpResponse.json({ ok: true, data: { settings } });
    }),
    http.post('/api/integrations/stripe/test', () =>
      HttpResponse.json({ ok: true, data: { ok: true, diagnostic: 'Stripe accepted the credentials.' } }),
    ),
    http.post('/api/integrations/ifirma/test', () =>
      HttpResponse.json({
        ok: true,
        data: { ok: true, diagnostic: 'iFirma accepted the username and faktura API key.' },
      }),
    ),
    http.post('/api/integrations/bunny/test', () =>
      HttpResponse.json({
        ok: true,
        data: { ok: true, diagnostic: 'Bunny Stream accepted the API key. Library lib-1 contains 3 video(s).' },
      }),
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
    renderPanel([
      { key: 'stripe.restrictedKey', maskedPreview: '••••2345', updatedAt: '2026-07-12T10:00:00.000Z' },
      { key: 'stripe.webhookSecret', maskedPreview: '••••9876', updatedAt: '2026-07-12T10:00:00.000Z' },
    ]);
    await userEvent.click(await screen.findByTestId('stripe-test-connection'));
    expect(await screen.findByTestId('stripe-test-result')).toHaveTextContent(
      'Stripe accepted the credentials.',
    );
  });

  it('guards the test button until both Stripe secrets are stored', async () => {
    renderPanel();
    const hint = await screen.findByTestId('stripe-test-hint');
    expect(hint).toHaveTextContent(pl.integrations.saveKeysFirst);
    expect(screen.getByTestId('stripe-test-connection')).toBeDisabled();
  });

  it('guards the Bunny test button until the key and library id are stored', async () => {
    renderPanel();
    const hint = await screen.findByTestId('bunny-test-hint');
    expect(hint).toHaveTextContent(pl.integrations.bunnySaveFirst);
    expect(screen.getByTestId('bunny-test-connection')).toBeDisabled();
    expect(await screen.findByText(pl.integrations.bunnySecurityHint)).toBeInTheDocument();
    expect(await screen.findByTestId('secret-input-bunny.securityKey')).toBeInTheDocument();
  });

  it('keeps iFirma credentials write-only and tests the stored authentication pair', async () => {
    renderPanel([
      { key: 'ifirma.invoiceApiKey', maskedPreview: '••••2345', updatedAt: '2026-07-12T10:00:00.000Z' },
      { key: 'ifirma.username', maskedPreview: '••••.com', updatedAt: '2026-07-12T10:00:00.000Z' },
    ]);

    expect(await screen.findByTestId('secret-input-ifirma.invoiceApiKey')).toHaveAttribute('type', 'password');
    expect(screen.getByTestId('secret-input-ifirma.username')).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByTestId('ifirma-test-connection'));
    expect(await screen.findByTestId('ifirma-test-result')).toHaveTextContent(
      'iFirma accepted the username and faktura API key.',
    );
  });

  it('guards the iFirma test until both credentials are stored', async () => {
    renderPanel();
    expect(await screen.findByTestId('ifirma-test-connection')).toBeDisabled();
    expect(screen.getByTestId('ifirma-test-hint')).toHaveTextContent(pl.integrations.ifirmaSaveFirst);
  });

  it('saves the Bunny library id and reports the connection diagnostic', async () => {
    renderPanel([
      { key: 'bunny.apiKey', maskedPreview: '••••2345', updatedAt: '2026-07-12T10:00:00.000Z' },
    ]);

    await userEvent.type(await screen.findByTestId('bunny-library-id'), 'lib-1');
    await userEvent.click(screen.getByTestId('bunny-library-id-save'));
    expect(await screen.findByTestId('bunny-library-id-saved')).toHaveTextContent(pl.integrations.saved);

    const testButton = screen.getByTestId('bunny-test-connection');
    await waitFor(() => {
      expect(testButton).toBeEnabled();
    });
    await userEvent.click(testButton);
    expect(await screen.findByTestId('bunny-test-result')).toHaveTextContent('3 video(s)');
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
