import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { apiKeyCreateInputSchema } from '#core/contract/index.js';
import type { StripeMode, TenantApiKeyPublic, TenantSecretMasked } from '#core/domain/index.js';

import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { PanelContextProvider } from '../panel-context.js';
import { IntegrationsPanel } from './IntegrationsPanel.js';

interface TestSettings {
  name: string;
  socialLinks: [];
  billingPortalUrl: string | null;
  bunnyStreamLibraryId: string | null;
  bunnyStreamCdnHostname: string | null;
}

const defaultSettings: TestSettings = {
  name: 'Akademia',
  socialLinks: [],
  billingPortalUrl: null,
  bunnyStreamLibraryId: null,
  bunnyStreamCdnHostname: null,
};

const renderPanel = (
  initial: TenantSecretMasked[] = [],
  initialSettings: TestSettings = defaultSettings,
  initialStripeMode: StripeMode | null = null,
  secretsState: 'success' | 'pending' | 'error' = 'success',
  initialApiKeys: TenantApiKeyPublic[] = [],
  staffRole: 'owner' | 'admin' = 'owner',
) => {
  let secrets = [...initial];
  let settings = { ...initialSettings };
  let stripeMode = initialStripeMode;
  const testedProviders: string[] = [];
  const storageSubmissions: unknown[] = [];
  const stripeConfigurations: string[] = [];
  const apiKeySubmissions: unknown[] = [];
  const settingsSubmissions: unknown[] = [];
  let apiKeys = [...initialApiKeys];

  server.use(
    http.get('/api/api-keys', () => HttpResponse.json({ ok: true, data: { apiKeys } })),
    http.get('/api/api-keys/:id/import-audit', ({ params }) => HttpResponse.json({
      ok: true,
      data: {
        events: [{
          id: 'audit-1', tenantId: 'tenant-123', apiKeyId: String(params.id), kind: 'member',
          importKey: 'member-source', resourceId: 'member-source', action: 'created',
          payloadHash: 'a'.repeat(64), at: '1998-08-14T10:00:00.000Z',
        }],
        nextCursor: null,
      },
    })),
    http.post('/api/api-keys', async ({ request }) => {
      const body = await request.json();
      apiKeySubmissions.push(body);
      const parsed = apiKeyCreateInputSchema.parse(body);
      const apiKey: TenantApiKeyPublic = {
        id: `import-key-${apiKeys.length + 1}`,
        tenantId: 'tenant-123',
        name: parsed.name,
        scopes: parsed.scopes ?? null,
        createdAt: '1998-08-14T10:00:00.000Z',
        expiresAt: parsed.expiresAt ?? null,
        revokedAt: null,
      };
      apiKeys = [...apiKeys, apiKey];
      return HttpResponse.json({ ok: true, data: { apiKey, secret: 'together_import_secret' } });
    }),
    http.delete('/api/api-keys/:id', ({ params }) => {
      const apiKey = apiKeys.find((key) => key.id === params.id);
      if (apiKey === undefined) {
        return HttpResponse.json(
          { ok: false, error: { code: 'not_found', message: 'missing' } },
          { status: 404 },
        );
      }
      const revoked = { ...apiKey, revokedAt: '1998-08-14T10:05:00.000Z' };
      apiKeys = apiKeys.map((key) => key.id === revoked.id ? revoked : key);
      return HttpResponse.json({ ok: true, data: { apiKey: revoked } });
    }),
    http.get('/api/tenant-secrets', async () => {
      if (secretsState === 'pending') return new Promise<never>(() => undefined);
      if (secretsState === 'error') {
        return HttpResponse.json(
          { ok: false, error: { code: 'integration_unavailable', message: 'offline' } },
          { status: 503 },
        );
      }
      return HttpResponse.json({
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
        updatedAt: '1998-07-12T10:00:00.000Z',
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
        { key: 'stripe.restrictedKey', maskedPreview: '••••2345', updatedAt: '1998-07-12T10:00:00.000Z' },
        { key: 'stripe.webhookSecret', maskedPreview: '••••9876', updatedAt: '1998-07-12T10:00:00.000Z' },
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
      if (typeof body === 'object' && body !== null && 'bunnyStreamCdnHostname' in body) {
        settings = { ...settings, bunnyStreamCdnHostname: body.bunnyStreamCdnHostname === null ? null : String(body.bunnyStreamCdnHostname) };
      }
      if (typeof body === 'object' && body !== null && 'billingPortalUrl' in body) {
        settings = { ...settings, billingPortalUrl: body.billingPortalUrl === null ? null : String(body.billingPortalUrl) };
        settingsSubmissions.push(body);
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
        updatedAt: '1998-08-03T12:00:00.000Z',
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
    http.post('/api/integrations/ksef/test', () =>
      HttpResponse.json({
        ok: true,
        data: { ok: true, diagnostic: 'KSeF accepted the token for this NIP context.' },
      }),
    ),
    http.get('/api/marketing/ses-settings', () => HttpResponse.json({
      ok: true,
      data: {
        credentialsConfigured: false,
        smtpConfigured: false,
        resendConfigured: false,
        platformPool: { used: 12, limit: 1000 },
        webhookUrl: 'https://app.example.test/api/webhooks/ses/webhook-token',
        settings: null,
      },
    })),
    http.get('/api/marketing/reputation', () => HttpResponse.json({
      ok: true,
      data: {
        windowStart: '1998-08-14T10:00:00.000Z',
        windowEnd: '1998-08-14T10:00:00.000Z',
        hardBounce: { count: 0, sends: 0, rate: null, status: 'insufficient_data' },
        complaint: { count: 0, sends: 0, rate: null, status: 'insufficient_data' },
        overallStatus: 'insufficient_data',
      },
    })),
  );

  return {
    ...renderWithProviders(
      <PanelContextProvider
        value={{
          tenant: { id: 'tenant-123', slug: 'akademia', name: 'Akademia', staffRole, memberId: null },
          email: 'creator@together.dev',
          emailVerified: true,
        }}
      >
        <IntegrationsPanel />
      </PanelContextProvider>,
    ),
    storageSubmissions,
    stripeConfigurations,
    testedProviders,
    apiKeySubmissions,
    settingsSubmissions,
  };
};

const openTab = async (label: string) => {
  await userEvent.click(await screen.findByRole('tab', { name: label }));
};

const fillMinioConfiguration = async () => {
  await openTab(pl.integrations.tabStorage);
  await userEvent.click(await screen.findByTestId('storage-provider-minio'));
  await userEvent.click(screen.getByTestId('storage-provider-continue'));
  await userEvent.type(screen.getByTestId('storage-endpoint'), 'http://localhost:9000');
  await userEvent.type(screen.getByTestId('storage-bucket'), 'together-test');
  await userEvent.type(screen.getByTestId('storage-access-key'), 'minio-access');
  await userEvent.type(screen.getByTestId('storage-secret-key'), 'minio-secret');
  await userEvent.click(screen.getByTestId('storage-connection-continue'));
};

describe('IntegrationsPanel', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/panel/integrations');
  });

  it('opens the Stripe tab by default and keeps the other services one tab away', async () => {
    renderPanel();

    expect(await screen.findByRole('tab', { name: pl.integrations.tabStripe })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await screen.findByTestId('stripe-webhook-url')).toBeInTheDocument();
    expect(screen.queryByTestId('bunny-test-connection')).not.toBeInTheDocument();

    await openTab(pl.integrations.tabVideo);

    expect(await screen.findByTestId('bunny-test-connection')).toBeInTheDocument();
    expect(screen.queryByTestId('stripe-webhook-url')).not.toBeInTheDocument();
    expect(window.location.hash).toBe('#video');
  });

  it.each([
    ['#payments', pl.integrations.tabStripe],
    ['#stripe', pl.integrations.tabStripe],
    ['#unknown', pl.integrations.tabStripe],
    ['#sending', pl.integrations.tabEmail],
    ['#ses', pl.integrations.tabEmail],
    ['#s3', pl.integrations.tabStorage],
    ['#bunny', pl.integrations.tabVideo],
    ['#ifirma', pl.integrations.tabInvoicing],
    ['#ksef', pl.integrations.tabInvoicing],
    ['#api-keys', pl.integrations.tabApiKeys],
  ])('opens %s on the %s tab', async (hash, label) => {
    window.history.replaceState(null, '', `/panel/integrations${hash}`);
    renderPanel();

    expect(await screen.findByRole('tab', { name: label })).toHaveAttribute('aria-selected', 'true');
  });

  it('follows a hash change while the panel stays mounted', async () => {
    renderPanel();
    await screen.findByTestId('stripe-webhook-url');

    window.location.hash = '#storage';

    expect(await screen.findByTestId('storage-test-connection')).toBeInTheDocument();
  });

  it('gathers the whole sending configuration under the e-mail tab', async () => {
    window.history.replaceState(null, '', '/panel/integrations#email');
    renderPanel();

    expect(await screen.findByTestId('email-test-connection')).toBeInTheDocument();
    expect(await screen.findByTestId('marketing-readiness')).toBeInTheDocument();
    expect(screen.getByTestId('marketing-webhook-url')).toHaveTextContent(
      'https://app.example.test/api/webhooks/ses/webhook-token',
    );
    expect(screen.getByLabelText(pl.marketing.accessKeyLabel)).toBeInTheDocument();
    expect(screen.getByLabelText(pl.marketing.fromAddressLabel)).toBeInTheDocument();
    expect(screen.getByLabelText(pl.marketing.smtpHostLabel)).toBeInTheDocument();
    expect(screen.getByLabelText(pl.marketing.resendApiKeyLabel)).toBeInTheDocument();
    expect(screen.getByLabelText(pl.marketing.footerLegalNameLabel)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: pl.marketing.wizardTitle })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: pl.marketing.reputationTitle })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: pl.marketing.quota })).toBeInTheDocument();
  });

  it('creates a short-lived import key with independently selectable scopes', async () => {
    const { apiKeySubmissions } = renderPanel();

    await openTab(pl.integrations.tabApiKeys);
    await userEvent.type(await screen.findByTestId('import-api-key-name'), 'CodeRoad migration');
    await userEvent.click(screen.getByTestId('import-api-key-content-scope'));
    await userEvent.click(screen.getByTestId('import-api-key-users-scope'));
    const expiry = screen.getByTestId('import-api-key-expiry');
    expect(expiry).toHaveAttribute('type', 'date');
    expect(expiry).toHaveAttribute('max');
    await userEvent.click(screen.getByTestId('import-api-key-create'));

    expect(await screen.findByLabelText(pl.integrations.importKeysSecretHeading)).toHaveValue(
      'together_import_secret',
    );
    expect(apiKeySubmissions).toHaveLength(1);
    expect(apiKeySubmissions[0]).toMatchObject({
      name: 'CodeRoad migration',
      scopes: ['import:content', 'import:users'],
    });
    const submission = apiKeyCreateInputSchema.parse(apiKeySubmissions[0]);
    expect(submission.expiresAt).toBeDefined();
    expect(Date.parse(submission.expiresAt ?? '')).toBeGreaterThan(Date.now());
  });

  it('lists active, expired, and revoked import keys and revokes an active key', async () => {
    const base: Pick<TenantApiKeyPublic, 'tenantId' | 'scopes' | 'createdAt'> = {
      tenantId: 'tenant-123',
      scopes: ['import:content'],
      createdAt: '1998-08-01T10:00:00.000Z',
    };
    renderPanel([], defaultSettings, null, 'success', [
      {
        ...base,
        id: 'active-key',
        name: 'Active migration',
        expiresAt: null,
        revokedAt: null,
      },
      {
        ...base,
        id: 'expired-key',
        name: 'Expired migration',
        expiresAt: '1992-08-10T10:00:00.000Z',
        revokedAt: null,
      },
      {
        ...base,
        id: 'revoked-key',
        name: 'Revoked migration',
        expiresAt: null,
        revokedAt: '1998-08-05T10:00:00.000Z',
      },
    ]);

    await openTab(pl.integrations.tabApiKeys);
    expect(await screen.findByTestId('import-api-key-active-key')).toHaveTextContent(
      pl.integrations.importKeysActive,
    );
    expect(screen.getByTestId('import-api-key-expired-key')).toHaveTextContent(
      pl.integrations.importKeysExpired,
    );
    expect(screen.getByTestId('import-api-key-revoked-key')).toHaveTextContent(
      pl.integrations.importKeysRevoked,
    );

    await userEvent.click(screen.getByTestId('import-api-key-revoke-active-key'));
    await userEvent.click(await screen.findByTestId('import-api-key-revoke-confirm'));
    await waitFor(() => {
      expect(screen.getByTestId('import-api-key-active-key')).toHaveTextContent(
        pl.integrations.importKeysRevoked,
      );
    });
  });

  it('opens the import audit from an import key', async () => {
    renderPanel([], defaultSettings, null, 'success', [{
      id: 'audited-key', tenantId: 'tenant-123', name: 'Audited migration',
      scopes: ['import:users'], createdAt: '1998-08-01T10:00:00.000Z',
      expiresAt: null, revokedAt: null,
    }]);

    await openTab(pl.integrations.tabApiKeys);
    await userEvent.click(await screen.findByTestId('import-api-key-audit-audited-key'));

    expect(await screen.findByText(/member member-source/)).toBeInTheDocument();
  });

  it.each(['pending', 'error'] as const)('does not claim credentials are missing while secrets are %s', async (state) => {
    renderPanel([], defaultSettings, null, state);

    if (state === 'error') await screen.findAllByRole('alert');
    expect(screen.queryByTestId('payment-test-hint')).not.toBeInTheDocument();

    await openTab(pl.integrations.tabStorage);

    if (state === 'error') await screen.findAllByRole('alert');
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
      { key: 'stripe.restrictedKey', maskedPreview: '••••2345', updatedAt: '1998-07-12T10:00:00.000Z' },
      { key: 'stripe.webhookSecret', maskedPreview: '••••9876', updatedAt: '1998-07-12T10:00:00.000Z' },
    ]);
    await userEvent.click(await screen.findByTestId('payment-test-connection'));
    expect(await screen.findByTestId('payment-test-result')).toHaveTextContent(
      pl.integrations.paymentAvailable,
    );
  });

  it('badges the mode a previously configured tenant stored', async () => {
    renderPanel([
      { key: 'stripe.restrictedKey', maskedPreview: '••••2345', updatedAt: '1998-07-12T10:00:00.000Z' },
      { key: 'stripe.webhookSecret', maskedPreview: '••••9876', updatedAt: '1998-07-12T10:00:00.000Z' },
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
      { key: 's3.accessKeyId', maskedPreview: '••••KEY1', updatedAt: '1998-07-12T10:00:00.000Z' },
      { key: 's3.secretAccessKey', maskedPreview: '••••KEY2', updatedAt: '1998-07-12T10:00:00.000Z' },
    ]);

    await openTab(pl.integrations.tabStorage);
    expect(await screen.findByTestId('storage-provider-minio')).toBeInTheDocument();
    expect(screen.getByTestId('storage-test-connection')).toBeDisabled();
    expect(screen.getByTestId('storage-test-hint')).toHaveTextContent(pl.integrations.s3SaveFirst);
  });

  it('runs storage, email and payment through one diagnostic contract', async () => {
    const { testedProviders } = renderPanel([
      { key: 'stripe.restrictedKey', maskedPreview: '••••2345', updatedAt: '1998-07-12T10:00:00.000Z' },
      { key: 'stripe.webhookSecret', maskedPreview: '••••9876', updatedAt: '1998-07-12T10:00:00.000Z' },
      { key: 's3.configuration', maskedPreview: '••••KEY2', updatedAt: '1998-07-12T10:00:00.000Z' },
    ]);

    await userEvent.click(await screen.findByTestId('payment-test-connection'));
    expect(await screen.findByTestId('payment-test-result')).toHaveTextContent(pl.integrations.paymentAvailable);

    await openTab(pl.integrations.tabEmail);
    await userEvent.click(await screen.findByTestId('email-test-connection'));
    expect(await screen.findByTestId('email-test-result')).toHaveTextContent(pl.integrations.emailAvailable);

    await openTab(pl.integrations.tabStorage);
    await userEvent.click(await screen.findByTestId('storage-test-connection'));
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
    await openTab(pl.integrations.tabStorage);
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
    await openTab(pl.integrations.tabVideo);
    const hint = await screen.findByTestId('bunny-test-hint');
    expect(hint).toHaveTextContent(pl.integrations.bunnySaveFirst);
    expect(screen.getByTestId('bunny-test-connection')).toBeDisabled();
    expect(await screen.findByText(pl.integrations.bunnySecurityHint)).toBeInTheDocument();
    expect(await screen.findByTestId('secret-input-bunny.securityKey')).toBeInTheDocument();
  });

  it('keeps iFirma credentials write-only and tests the stored authentication pair', async () => {
    renderPanel([
      { key: 'ifirma.invoiceApiKey', maskedPreview: '••••2345', updatedAt: '1998-07-12T10:00:00.000Z' },
      { key: 'ifirma.username', maskedPreview: '••••.com', updatedAt: '1998-07-12T10:00:00.000Z' },
    ]);

    await openTab(pl.integrations.tabInvoicing);
    expect(await screen.findByTestId('secret-input-ifirma.invoiceApiKey')).toHaveAttribute('type', 'password');
    expect(screen.getByTestId('secret-input-ifirma.username')).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByTestId('ifirma-test-connection'));
    expect(await screen.findByTestId('ifirma-test-result')).toHaveTextContent(
      'iFirma accepted the username and faktura API key.',
    );
  });

  it('guards the iFirma test until both credentials are stored', async () => {
    renderPanel();
    await openTab(pl.integrations.tabInvoicing);
    expect(await screen.findByTestId('ifirma-test-connection')).toBeDisabled();
    expect(screen.getByTestId('ifirma-test-hint')).toHaveTextContent(pl.integrations.ifirmaSaveFirst);
  });

  it('tests stored KSeF credentials where they are configured', async () => {
    renderPanel([
      { key: 'ksef.token', maskedPreview: '••••2345', updatedAt: '1998-07-12T10:00:00.000Z' },
      { key: 'ksef.contextNip', maskedPreview: '••••5555', updatedAt: '1998-07-12T10:00:00.000Z' },
    ]);

    await openTab(pl.integrations.tabInvoicing);
    const testButton = await screen.findByTestId('ksef-test-connection');
    await waitFor(() => {
      expect(testButton).toBeEnabled();
    });
    await userEvent.click(testButton);

    expect(await screen.findByTestId('ksef-test-result')).toHaveTextContent(
      'KSeF accepted the token for this NIP context.',
    );
  });

  it('guards the KSeF test until the token and context NIP are stored', async () => {
    renderPanel();
    await openTab(pl.integrations.tabInvoicing);
    expect(await screen.findByTestId('ksef-test-connection')).toBeDisabled();
    expect(screen.getByTestId('ksef-test-hint')).toHaveTextContent(pl.integrations.ksefSaveFirst);
  });

  it('saves the Bunny library id and reports the connection diagnostic', async () => {
    renderPanel([
      { key: 'bunny.apiKey', maskedPreview: '••••2345', updatedAt: '1998-07-12T10:00:00.000Z' },
    ]);

    await openTab(pl.integrations.tabVideo);
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

  it('saves the Bunny Stream CDN hostname', async () => {
    renderPanel();

    await openTab(pl.integrations.tabVideo);
    const input = await screen.findByTestId('bunny-cdn-hostname');
    expect(input).toHaveAttribute('placeholder', 'vz-xxxxxxx-xxx.b-cdn.net');
    expect(screen.getByText(pl.integrations.bunnyCdnHostnameHelper)).toBeInTheDocument();
    await userEvent.type(input, 'vz-demo-123.b-cdn.net');
    await userEvent.click(screen.getByTestId('bunny-cdn-hostname-save'));

    expect(await screen.findByTestId('bunny-cdn-hostname-saved')).toHaveTextContent(
      pl.integrations.saved,
    );
    await waitFor(() => {
      expect(screen.getByTestId('bunny-cdn-hostname')).toHaveValue('vz-demo-123.b-cdn.net');
    });
  });

  it('removes a configured iFirma invoice API key', async () => {
    renderPanel([
      { key: 'ifirma.invoiceApiKey', maskedPreview: '••••2345', updatedAt: '1998-07-12T10:00:00.000Z' },
    ]);

    await openTab(pl.integrations.tabInvoicing);
    const field = (await screen.findByTestId('secret-input-ifirma.invoiceApiKey')).closest('form');
    expect(field).not.toBeNull();
    if (!field) return;
    await userEvent.click(within(field).getByTestId('secret-remove-ifirma.invoiceApiKey'));
    expect(await screen.findByText(pl.integrations.removeSecretConfirmBody({ label: pl.integrations.ifirmaInvoiceApiKeyLabel }))).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('secret-remove-confirm-ifirma.invoiceApiKey'));

    await waitFor(() => {
      expect(screen.getByTestId('secret-status-ifirma.invoiceApiKey')).toHaveTextContent(
        pl.integrations.notConfigured,
      );
    });
  });

  it('removes a configured iFirma username', async () => {
    renderPanel([
      { key: 'ifirma.username', maskedPreview: '••••2345', updatedAt: '1998-07-12T10:00:00.000Z' },
    ]);

    await openTab(pl.integrations.tabInvoicing);
    const field = (await screen.findByTestId('secret-input-ifirma.username')).closest('form');
    expect(field).not.toBeNull();
    if (!field) return;
    await userEvent.click(within(field).getByTestId('secret-remove-ifirma.username'));
    expect(await screen.findByText(pl.integrations.removeSecretConfirmBody({ label: pl.integrations.ifirmaUsernameLabel }))).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('secret-remove-confirm-ifirma.username'));

    await waitFor(() => {
      expect(screen.getByTestId('secret-status-ifirma.username')).toHaveTextContent(
        pl.integrations.notConfigured,
      );
    });
  });

  it('removes both Stripe credentials from the configuration card', async () => {
    renderPanel([
      { key: 'stripe.restrictedKey', maskedPreview: '••••2345', updatedAt: '1998-07-12T10:00:00.000Z' },
      { key: 'stripe.webhookSecret', maskedPreview: '••••9876', updatedAt: '1998-07-12T10:00:00.000Z' },
    ], defaultSettings, 'live');

    await userEvent.click(await screen.findByTestId('stripe-remove'));
    expect(await screen.findByText(pl.integrations.stripeDisconnectConfirmBody)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('stripe-remove-confirm'));

    await waitFor(() => {
      expect(screen.getByTestId('stripe-key-status')).toHaveTextContent(
        pl.integrations.notConfigured,
      );
    });
    expect(screen.queryByTestId('stripe-mode-badge')).not.toBeInTheDocument();
    expect(screen.getByTestId('payment-test-connection')).toBeDisabled();
  });

  it('saves the member billing portal URL alongside the Stripe credentials', async () => {
    const { settingsSubmissions } = renderPanel();

    await userEvent.type(
      await screen.findByTestId('billing-portal-url'),
      'https://billing.stripe.com/p/login/test',
    );
    await userEvent.click(screen.getByTestId('billing-portal-save'));

    expect(await screen.findByTestId('billing-portal-saved')).toBeInTheDocument();
    expect(settingsSubmissions).toEqual([
      { billingPortalUrl: 'https://billing.stripe.com/p/login/test' },
    ]);
  });

  it('keeps the billing portal URL read-only for staff without the owner role', async () => {
    renderPanel([], defaultSettings, null, 'success', [], 'admin');

    expect(await screen.findByTestId('billing-portal-url')).toBeDisabled();
    expect(screen.queryByTestId('billing-portal-save')).not.toBeInTheDocument();
  });
});
