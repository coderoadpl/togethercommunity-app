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
  name: string;
  socialLinks: [];
  billingPortalUrl: string | null;
  bunnyStreamLibraryId: string | null;
}

const defaultSettings: TestSettings = {
  name: 'Akademia',
  socialLinks: [],
  billingPortalUrl: null,
  bunnyStreamLibraryId: null,
};

const renderPanel = (
  initial: TenantSecretMasked[] = [],
  initialSettings: TestSettings = defaultSettings,
  initialStripeMode: StripeMode | null = null,
  secretsState: 'success' | 'pending' | 'error' = 'success',
) => {
  let secrets = [...initial];
  let settings = { ...initialSettings };
  let stripeMode = initialStripeMode;
  const testedProviders: string[] = [];
  const storageSubmissions: unknown[] = [];
  const stripeConfigurations: string[] = [];

  server.use(
    http.get('/api/tenant-secrets', async () => {
      if (secretsState === 'pending') return new Promise<never>(() => undefined);
      return secretsState === 'error'
        ? HttpResponse.json(
            { ok: false, error: { code: 'integration_unavailable', message: 'offline' } },
            { status: 503 },
          )
        : HttpResponse.json({
        ok: true,
        data: {
          secrets,
          stripeMode,
          stripeWebhookUrl: 'https://app.example.test/base/api/webhooks/stripe/tenant-123',
        },
      });
    }),
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
          key === 's3.configuration' ||
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
    http.post('/api/integrations/storage/probe', async ({ request }) => {
      storageSubmissions.push(await request.json());
      return HttpResponse.json({
        ok: true,
        data: { diagnostic: { code: 'storage.available', message: 'probe complete' } },
      });
    }),
    http.post('/api/integrations/storage/configure', async ({ request }) => {
      storageSubmissions.push(await request.json());
      const secret: TenantSecretMasked = {
        key: 's3.configuration',
        maskedPreview: '••••',
        updatedAt: '2026-08-03T12:00:00.000Z',
      };
      secrets = [...secrets.filter((item) => item.key !== secret.key), secret];
      return HttpResponse.json({
        ok: true,
        data: {
          diagnostic: { code: 'storage.available', message: 'probe complete' },
          secret,
        },
      });
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
    storageSubmissions,
    stripeConfigurations,
    testedProviders,
  };
};

const fillMinioConfiguration = async () => {
  await userEvent.click(await screen.findByTestId('storage-provider-minio'));
  await userEvent.click(screen.getByTestId('storage-provider-continue'));
  await userEvent.type(screen.getByTestId('storage-endpoint'), 'http://localhost:9000');
  await userEvent.type(screen.getByTestId('storage-bucket'), 'together-test');
  await userEvent.type(screen.getByTestId('storage-access-key'), 'minio-access');
  await userEvent.type(screen.getByTestId('storage-secret-key'), 'minio-secret');
  await userEvent.click(screen.getByTestId('storage-connection-continue'));
};

describe('IntegrationsPanel', () => {
  it.each(['pending', 'error'] as const)('does not claim credentials are missing while secrets are %s', async (state) => {
    renderPanel([], defaultSettings, null, state);

    if (state === 'error') await screen.findAllByRole('alert');
    expect(screen.queryByTestId('payment-test-hint')).not.toBeInTheDocument();
    expect(screen.queryByTestId('storage-test-hint')).not.toBeInTheDocument();
  });

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

  it('requires the storage wizard when only legacy credentials are stored', async () => {
    renderPanel([
      { key: 's3.accessKeyId', maskedPreview: '••••KEY1', updatedAt: '2026-07-12T10:00:00.000Z' },
      { key: 's3.secretAccessKey', maskedPreview: '••••KEY2', updatedAt: '2026-07-12T10:00:00.000Z' },
    ]);

    expect(await screen.findByTestId('storage-provider-minio')).toBeInTheDocument();
    expect(screen.getByTestId('storage-test-connection')).toBeDisabled();
    expect(screen.getByTestId('storage-test-hint')).toHaveTextContent(pl.integrations.s3SaveFirst);
  });

  it('runs storage, email and payment through one diagnostic contract', async () => {
    const { testedProviders } = renderPanel([
      { key: 'stripe.restrictedKey', maskedPreview: '••••2345', updatedAt: '2026-07-12T10:00:00.000Z' },
      { key: 'stripe.webhookSecret', maskedPreview: '••••9876', updatedAt: '2026-07-12T10:00:00.000Z' },
      { key: 's3.configuration', maskedPreview: '••••KEY2', updatedAt: '2026-07-12T10:00:00.000Z' },
    ]);

    await userEvent.click(await screen.findByTestId('payment-test-connection'));
    await userEvent.click(screen.getByTestId('email-test-connection'));
    await userEvent.click(screen.getByTestId('storage-test-connection'));

    expect(await screen.findByTestId('payment-test-result')).toHaveTextContent(pl.integrations.paymentAvailable);
    expect(await screen.findByTestId('email-test-result')).toHaveTextContent(pl.integrations.emailAvailable);
    expect(await screen.findByTestId('storage-test-result')).toHaveTextContent(pl.integrations.storageAvailable);
    expect(testedProviders).toEqual(['payment', 'email', 'storage']);
  });

  it('probes MinIO before saving the encrypted storage configuration', async () => {
    const { storageSubmissions } = renderPanel();
    await fillMinioConfiguration();

    expect(screen.getByText(pl.integrations.storageProbeDescription)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('storage-probe'));
    expect(await screen.findByTestId('storage-probe-success')).toHaveTextContent(
      pl.integrations.storageProbeSuccess,
    );
    expect(screen.getByTestId('storage-save')).toBeEnabled();

    await userEvent.click(screen.getByTestId('storage-save'));
    expect(await screen.findByTestId('storage-save-success')).toHaveTextContent(
      pl.integrations.storageSaved,
    );
    expect(storageSubmissions).toEqual([
      {
        provider: 'minio',
        endpoint: 'http://localhost:9000',
        region: 'us-east-1',
        bucket: 'together-test',
        accessKeyId: 'minio-access',
        secretAccessKey: 'minio-secret',
      },
      {
        provider: 'minio',
        endpoint: 'http://localhost:9000',
        region: 'us-east-1',
        bucket: 'together-test',
        accessKeyId: 'minio-access',
        secretAccessKey: 'minio-secret',
      },
    ]);
  });

  it.each([
    ['aws_s3', pl.integrations.storageInstructionAws, 'docs.aws.amazon.com'],
    ['cloudflare_r2', pl.integrations.storageInstructionR2, 'developers.cloudflare.com'],
    ['backblaze_b2', pl.integrations.storageInstructionB2, 'backblaze.com'],
    ['minio', pl.integrations.storageInstructionMinio, 'min.io'],
  ])('shows scoped key instructions for %s', async (provider, instructions, host) => {
    renderPanel();
    await userEvent.click(await screen.findByTestId(`storage-provider-${provider}`));
    await userEvent.click(screen.getByTestId('storage-provider-continue'));

    expect(screen.getByText(instructions)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: pl.integrations.storageInstructionLink })).toHaveAttribute(
      'href',
      expect.stringContaining(host),
    );
  });

  it.each([
    ['storage.wrong_region', pl.integrations.storageProbeWrongRegion],
    ['storage.credentials', pl.integrations.storageProbeCredentials],
    ['storage.bucket', pl.integrations.storageProbeBucket],
    ['storage.cors', pl.integrations.storageProbeCors],
    ['storage.unavailable', pl.integrations.storageProbeUnavailable],
  ])('renders the mapped %s failure without raw SDK text', async (providerCode, message) => {
    renderPanel();
    server.use(
      http.post('/api/integrations/storage/probe', () =>
        HttpResponse.json(
          {
            ok: false,
            error: {
              code: 'integration_unavailable',
              message: 'RAW SDK ERROR',
              details: { providerCode },
            },
          },
          { status: 503 },
        ),
      ),
    );
    await fillMinioConfiguration();
    await userEvent.click(screen.getByTestId('storage-probe'));

    const alert = await screen.findByTestId('storage-probe-error');
    expect(alert).toHaveTextContent(message);
    expect(alert).not.toHaveTextContent('RAW SDK ERROR');
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
      { key: 'ifirma.username', maskedPreview: '••••2345', updatedAt: '2026-07-12T10:00:00.000Z' },
    ]);

    const field = (await screen.findByTestId('secret-input-ifirma.username')).closest('form');
    expect(field).not.toBeNull();
    if (!field) return;
    await userEvent.click(within(field).getByTestId('secret-remove-ifirma.username'));

    await waitFor(() => {
      expect(screen.getByTestId('secret-status-ifirma.username')).toHaveTextContent(
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
