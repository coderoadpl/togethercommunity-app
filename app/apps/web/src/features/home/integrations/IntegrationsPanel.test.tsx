import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { StripeMode, TenantSecretMasked } from '#core/domain/index.js';

import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { IntegrationsPanel } from './IntegrationsPanel.js';

interface TestSettings {
  billingPortalUrl: string | null;
  bunnyStreamLibraryId: string | null;
}

const defaultSettings: TestSettings = { billingPortalUrl: null, bunnyStreamLibraryId: null };

const renderPanel = (
  initial: TenantSecretMasked[] = [],
  initialSettings: TestSettings = defaultSettings,
  initialStripeMode: StripeMode | null = null,
) => {
  let secrets = [...initial];
  let settings = { ...initialSettings };
  let stripeMode = initialStripeMode;
  const testedProviders: string[] = [];
  const stripeConfigurations: string[] = [];

  server.use(
    http.get('/api/tenant-secrets', () =>
      HttpResponse.json({
        ok: true,
        data: {
          secrets,
          stripeMode,
          stripeWebhookUrl: 'https://app.example.test/base/api/webhooks/stripe/tenant-123',
        },
      }),
    ),
    http.post('/api/tenant-secrets', async ({ request }) => {
      const body = await request.json();
      const key = typeof body === 'object' && body !== null && 'key' in body ? String(body.key) : '';
      const secret: TenantSecretMasked = {
        key:
          key === 'stripe.webhookSecret' ||
          key === 'bunny.apiKey' ||
          key === 'bunny.securityKey' ||
          key === 's3.accessKeyId' ||
          key === 's3.secretAccessKey' ||
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
    http.post('/api/integrations/stripe/configure', async ({ request }) => {
      const body = await request.json();
      const restrictedKey = typeof body === 'object' && body !== null && 'restrictedKey' in body
        ? String(body.restrictedKey)
        : '';
      stripeConfigurations.push(restrictedKey);
      stripeMode = restrictedKey.startsWith('rk_live_') ? 'live' : 'test';
      secrets = [
        ...secrets.filter((secret) => !secret.key.startsWith('stripe.')),
        { key: 'stripe.restrictedKey', maskedPreview: '••••2345', updatedAt: '2026-07-12T10:00:00.000Z' },
        { key: 'stripe.webhookSecret', maskedPreview: '••••9876', updatedAt: '2026-07-12T10:00:00.000Z' },
      ];
      return HttpResponse.json({
        ok: true,
        data: {
          mode: stripeMode,
          webhookUrl: 'https://app.example.test/api/webhooks/stripe/tenant-123',
        },
      });
    }),
    http.delete('/api/tenant-secrets/:key', ({ params }) => {
      secrets = secrets.filter((s) => s.key !== params.key);
      if (params.key === 'stripe.restrictedKey') stripeMode = null;
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
    http.post('/api/integrations/test', async ({ request }) => {
      const body = await request.json();
      const provider = typeof body === 'object' && body !== null && 'provider' in body
        ? String(body.provider)
        : '';
      testedProviders.push(provider);
      const code = provider === 'storage'
        ? 'storage.available'
        : provider === 'email'
          ? 'email.available'
          : 'payment.available';
      return HttpResponse.json({ ok: true, data: { diagnostic: { code, message: 'adapter message' } } });
    }),
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

  return {
    ...renderWithProviders(<IntegrationsPanel />),
    stripeConfigurations,
    testedProviders,
  };
};

describe('IntegrationsPanel', () => {
  it('shows the per-tenant webhook URL that Together registers automatically', async () => {
    renderPanel();
    const url = await screen.findByTestId('stripe-webhook-url');
    await waitFor(() => {
      expect(url).toHaveValue('https://app.example.test/base/api/webhooks/stripe/tenant-123');
    });
    expect(screen.getByText(pl.integrations.webhookUrlHint)).toBeInTheDocument();
  });

  it('saves the restricted key, creates the webhook, and shows the persisted live-mode badge', async () => {
    const { stripeConfigurations } = renderPanel();

    const status = await screen.findByTestId('stripe-key-status');
    expect(status).toHaveTextContent(pl.integrations.notConfigured);

    await userEvent.type(screen.getByTestId('stripe-restricted-key'), 'rk_live_secret2345');
    await userEvent.click(screen.getByTestId('stripe-configure'));

    expect(await screen.findByTestId('stripe-configured')).toHaveTextContent(pl.integrations.stripeConfigured);
    await waitFor(() => {
      expect(screen.getByTestId('stripe-key-status')).toHaveTextContent(pl.integrations.configured);
    });
    expect(screen.getByTestId('stripe-key-status')).toHaveTextContent('••••2345');
    expect(screen.getByTestId('stripe-mode-badge')).toHaveTextContent(pl.integrations.stripeLiveMode);
    expect(stripeConfigurations).toEqual(['rk_live_secret2345']);
    expect(screen.getByText(pl.integrations.webhookActiveHint)).toBeInTheDocument();
  });

  it('reports a readable diagnostic after testing the connection', async () => {
    renderPanel([
      { key: 'stripe.restrictedKey', maskedPreview: '••••2345', updatedAt: '2026-07-12T10:00:00.000Z' },
      { key: 'stripe.webhookSecret', maskedPreview: '••••9876', updatedAt: '2026-07-12T10:00:00.000Z' },
    ]);
    await userEvent.click(await screen.findByTestId('payment-test-connection'));
    expect(await screen.findByTestId('payment-test-result')).toHaveTextContent(
      pl.integrations.paymentAvailable,
    );
  });

  it('badges the mode a previously configured tenant stored', async () => {
    renderPanel([
      { key: 'stripe.restrictedKey', maskedPreview: '••••2345', updatedAt: '2026-07-12T10:00:00.000Z' },
      { key: 'stripe.webhookSecret', maskedPreview: '••••9876', updatedAt: '2026-07-12T10:00:00.000Z' },
    ], defaultSettings, 'test');

    expect(await screen.findByTestId('stripe-mode-badge')).toHaveTextContent(
      pl.integrations.stripeTestMode,
    );
  });

  it('guards the test button until both Stripe secrets are stored', async () => {
    renderPanel();
    const hint = await screen.findByTestId('payment-test-hint');
    expect(hint).toHaveTextContent(pl.integrations.saveKeysFirst);
    expect(screen.getByTestId('payment-test-connection')).toBeDisabled();
  });

  it('runs storage, email and payment through one diagnostic contract', async () => {
    const { testedProviders } = renderPanel([
      { key: 'stripe.restrictedKey', maskedPreview: '••••2345', updatedAt: '2026-07-12T10:00:00.000Z' },
      { key: 'stripe.webhookSecret', maskedPreview: '••••9876', updatedAt: '2026-07-12T10:00:00.000Z' },
      { key: 's3.accessKeyId', maskedPreview: '••••KEY1', updatedAt: '2026-07-12T10:00:00.000Z' },
      { key: 's3.secretAccessKey', maskedPreview: '••••KEY2', updatedAt: '2026-07-12T10:00:00.000Z' },
    ]);

    await userEvent.click(await screen.findByTestId('payment-test-connection'));
    await userEvent.click(screen.getByTestId('email-test-connection'));
    await userEvent.click(screen.getByTestId('storage-test-connection'));

    expect(await screen.findByTestId('payment-test-result')).toHaveTextContent(pl.integrations.paymentAvailable);
    expect(await screen.findByTestId('email-test-result')).toHaveTextContent(pl.integrations.emailAvailable);
    expect(await screen.findByTestId('storage-test-result')).toHaveTextContent(pl.integrations.storageAvailable);
    expect(testedProviders).toEqual(['payment', 'email', 'storage']);
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
      { key: 's3.accessKeyId', maskedPreview: '••••2345', updatedAt: '2026-07-12T10:00:00.000Z' },
    ]);

    const field = (await screen.findByTestId('secret-input-s3.accessKeyId')).closest('form');
    expect(field).not.toBeNull();
    if (!field) return;
    await userEvent.click(within(field).getByTestId('secret-remove-s3.accessKeyId'));

    await waitFor(() => {
      expect(screen.getByTestId('secret-status-s3.accessKeyId')).toHaveTextContent(
        pl.integrations.notConfigured,
      );
    });
  });

  it('removes both Stripe credentials from the configuration card', async () => {
    renderPanel([
      { key: 'stripe.restrictedKey', maskedPreview: '••••2345', updatedAt: '2026-07-12T10:00:00.000Z' },
      { key: 'stripe.webhookSecret', maskedPreview: '••••9876', updatedAt: '2026-07-12T10:00:00.000Z' },
    ], defaultSettings, 'live');

    await userEvent.click(await screen.findByTestId('stripe-remove'));

    await waitFor(() => {
      expect(screen.getByTestId('stripe-key-status')).toHaveTextContent(
        pl.integrations.notConfigured,
      );
    });
    expect(screen.queryByTestId('stripe-mode-badge')).not.toBeInTheDocument();
    expect(screen.getByTestId('payment-test-connection')).toBeDisabled();
  });
});
