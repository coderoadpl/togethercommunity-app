import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { EmailTab } from './EmailTab.js';

const now = '2026-07-27T10:00:00.000Z';

const sesSettings = {
  ok: true,
  data: {
    credentialsConfigured: true,
    smtpConfigured: true,
    resendConfigured: true,
    platformPool: { used: 25, limit: 1000 },
    webhookUrl: 'https://app.test/api/webhooks/ses/webhook-token',
    lastSnsDelivery: null,
    settings: {
      tenantId: 'tenant-1',
      fromAddress: 'news@tenant.test',
      fromName: 'Tenant',
      identity: 'tenant.test',
      identityVerifiedAt: now,
      identityCheckedAt: '2026-07-20T10:00:00.000Z',
      identityCheckError: null,
      configurationSet: 'together-tenant-1',
      snsTopicArn: 'arn:aws:sns:eu-central-1:123:together-tenant-1',
      snsSubscriptionEndpoint: 'https://app.test/api/webhooks/ses/webhook-token',
      snsSubscriptionConfirmedAt: now,
      trackingEnabled: false,
      autoPauseOnCritical: false,
      webhookToken: 'webhook_token_123456789012345',
      quotaRatePerSec: 10,
      quotaDaily: 50_000,
      quotaSentLast24Hours: 25,
      quotaRefreshedAt: now,
      inSandbox: false,
      webhookVerifiedAt: null,
      footerLegalName: 'Tenant Ltd',
      footerAddress: 'Street 1, Warsaw',
      broadcastsEnabled: false,
      reputationAlertStatus: null,
      reputationAlertedAt: null,
    },
  },
};

const reputation = {
  ok: true,
  data: {
    windowStart: now,
    windowEnd: now,
    hardBounce: { count: 0, sends: 0, rate: null, status: 'insufficient_data' },
    complaint: { count: 0, sends: 0, rate: null, status: 'insufficient_data' },
    overallStatus: 'insufficient_data',
  },
};

const unconfiguredSender = {
  ok: true,
  data: {
    credentialsConfigured: true,
    smtpConfigured: false,
    resendConfigured: false,
    platformPool: { used: 0, limit: 1000 },
    webhookUrl: null,
    settings: null,
    lastSnsDelivery: null,
  },
};

describe('email transport wizard', () => {
  it('keeps SES onboarding and runs the shared SMTP, SES and Resend test-email flow', async () => {
    const testedTransports: string[] = [];
    server.use(
      http.get('/api/marketing/ses-settings', () => HttpResponse.json(sesSettings)),
      http.get('/api/marketing/reputation', () => HttpResponse.json(reputation)),
      http.post('/api/marketing/ses-onboarding/poll', () => HttpResponse.json({
        ok: true,
        data: {
          identityVerified: false,
          dkimVerified: false,
          identityRegressed: true,
          records: [{
            name: 'token._domainkey.tenant.test',
            type: 'CNAME',
            value: 'token.dkim.amazonses.com',
          }],
          configurationSetReady: true,
          eventDestinationReady: true,
          subscriptionConfirmed: true,
          feedbackForwardingDisabled: true,
          checklist: {
            credentials: true,
            identity: false,
            configurationSet: true,
            snsSubscription: true,
            webhook: false,
            footer: true,
            productionAccess: true,
          },
        },
      })),
      http.post('/api/integrations/test', async ({ request }) => {
        const body = await request.json();
        if (typeof body === 'object' && body !== null && 'emailTransport' in body) {
          testedTransports.push(String(body.emailTransport));
        }
        return HttpResponse.json({
          ok: true,
          data: { diagnostic: { code: 'email.available', message: 'Test e-mail sent.' } },
        });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<EmailTab />);

    expect(within((await screen.findByText('Zestaw konfiguracji SES')).closest('li') ?? document.body).getByText('Gotowe')).toBeInTheDocument();
    expect(within(screen.getByText('Subskrypcja SNS').closest('li') ?? document.body).getByText('Gotowe')).toBeInTheDocument();
    expect(screen.getByText(/Weryfikacja nieaktualna/)).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Sprawdź status w AWS' }));

    expect(await screen.findByText(/AWS nie zgłasza już tej tożsamości/)).toBeInTheDocument();
    expect(screen.getByText(/token\._domainkey\.tenant\.test/)).toBeInTheDocument();
    expect(screen.getByText(/Przekazywanie powiadomień tożsamości jest wyłączone/)).toBeInTheDocument();

    const testButtons = screen.getAllByRole('button', { name: 'Wyślij test do siebie' });
    expect(testButtons).toHaveLength(3);
    for (const button of testButtons) await user.click(button);

    expect(await screen.findAllByText(/Transport przeszedł diagnostykę/)).toHaveLength(3);
    expect(testedTransports).toEqual(['ses', 'smtp', 'resend']);
  }, 15_000);

  it('derives SNS readiness from the confirmed subscription instead of the topic ARN', async () => {
    server.use(
      http.get('/api/marketing/ses-settings', () => HttpResponse.json({
        ...sesSettings,
        data: {
          ...sesSettings.data,
          settings: { ...sesSettings.data.settings, snsSubscriptionConfirmedAt: null },
          lastSnsDelivery: {
            tenantId: 'tenant-1',
            receivedAt: new Date(Date.now() - 120_000).toISOString(),
            messageType: 'SubscriptionConfirmation',
            outcome: 'confirm_failed',
            errorMessage: 'SNS confirmation returned HTTP 503',
            sourceIp: null,
            userAgent: null,
          },
        },
      })),
      http.get('/api/marketing/reputation', () => HttpResponse.json(reputation)),
    );
    renderWithProviders(<EmailTab />);

    const subscriptionRow = (await screen.findByText('Subskrypcja SNS')).closest('li') ?? document.body;
    expect(within(subscriptionRow).getByText('Wymaga działania')).toBeInTheDocument();
    expect(await screen.findByTestId('marketing-sns-last-delivery')).toHaveTextContent(
      /Ostatnie zdarzenie z SNS: SubscriptionConfirmation · .* · potwierdzenie nie powiodło się/,
    );
  }, 15_000);

  it('reports what provisioning created and polls AWS again without a page reload', async () => {
    let settingsReads = 0;
    server.use(
      http.get('/api/marketing/ses-settings', () => {
        settingsReads += 1;
        return HttpResponse.json(sesSettings);
      }),
      http.get('/api/marketing/reputation', () => HttpResponse.json(reputation)),
      http.post('/api/marketing/ses-onboarding/infrastructure', () => HttpResponse.json({
        ok: true,
        data: {
          configurationSet: 'together-tenant-1',
          topicArn: 'arn:aws:sns:eu-central-1:123:together-tenant-1',
          subscriptionEndpoint: 'https://app.test/api/webhooks/ses/webhook-token',
          subscriptionConfirmed: false,
          feedbackForwardingDisabled: false,
        },
      })),
      http.post('/api/marketing/ses-onboarding/poll', () => HttpResponse.json({
        ok: true,
        data: {
          identityVerified: true,
          dkimVerified: true,
          identityRegressed: false,
          records: [],
          configurationSetReady: true,
          eventDestinationReady: true,
          subscriptionConfirmed: false,
          feedbackForwardingDisabled: false,
          checklist: {
            credentials: true, identity: true, configurationSet: true, snsSubscription: false,
            webhook: false, footer: true, productionAccess: true,
          },
        },
      })),
    );
    const user = userEvent.setup();
    renderWithProviders(<EmailTab />);

    await user.click(await screen.findByRole('button', { name: 'Utwórz infrastrukturę SES + SNS' }));

    expect(await screen.findByText('Infrastruktura SES + SNS jest utworzona')).toBeInTheDocument();
    expect(screen.getByText(/Endpoint subskrypcji: https:\/\/app\.test\/api\/webhooks\/ses\/webhook-token/))
      .toBeInTheDocument();
    await screen.findByText(/Subskrypcja SNS czeka na potwierdzenie/);
    await vi.waitFor(() => {
      expect(settingsReads).toBeGreaterThan(1);
    });

    await user.click(screen.getByRole('button', { name: 'Sprawdź status w AWS' }));

    await vi.waitFor(() => {
      expect(screen.queryByText('Infrastruktura SES + SNS jest utworzona')).not.toBeInTheDocument();
    });
  }, 15_000);

  it('shows the AWS message verbatim when provisioning fails as integration_unavailable', async () => {
    const awsMessage = 'Could not create the SNS topic. AWS: InvalidParameterException: Invalid parameter: Policy statement action out of service scope!';
    server.use(
      http.get('/api/marketing/ses-settings', () => HttpResponse.json(sesSettings)),
      http.get('/api/marketing/reputation', () => HttpResponse.json(reputation)),
      http.post('/api/marketing/ses-onboarding/infrastructure', () => HttpResponse.json(
        { ok: false, error: { code: 'integration_unavailable', message: awsMessage } },
        { status: 503 },
      )),
    );
    const user = userEvent.setup();
    renderWithProviders(<EmailTab />);

    await user.click(await screen.findByRole('button', { name: 'Utwórz infrastrukturę SES + SNS' }));

    expect(await screen.findByText('Usługa AWS odrzuciła operację')).toBeInTheDocument();
    expect(screen.getByText(awsMessage)).toBeInTheDocument();
  }, 15_000);

  it('prefills the single verified SES domain and badges the detected identities', async () => {
    server.use(
      http.get('/api/marketing/ses-settings', () => HttpResponse.json(unconfiguredSender)),
      http.get('/api/marketing/reputation', () => HttpResponse.json(reputation)),
      http.get('/api/marketing/ses-onboarding/identities', () => HttpResponse.json({
        ok: true,
        data: {
          identities: [
            { identity: 'owner@tenant.test', kind: 'email', verified: true, dkimVerified: true },
            { identity: 'old.tenant.test', kind: 'domain', verified: false, dkimVerified: false },
            { identity: 'tenant.test', kind: 'domain', verified: true, dkimVerified: true },
          ],
          accessDeniedAction: null,
        },
      })),
    );
    const user = userEvent.setup();
    renderWithProviders(<EmailTab />);

    expect(await screen.findByText(/Adres nadawcy musi należeć do domeny tenant\.test/)).toBeInTheDocument();
    expect(screen.getByLabelText('Zweryfikowana domena lub adres')).toHaveValue('tenant.test');
    expect(screen.getByText('Sprawdzenie nastąpi po zapisaniu nadawcy')).toBeInTheDocument();
    expect(screen.getByText(/Domena jest już zweryfikowana w SES/)).toBeInTheDocument();

    await user.click(screen.getByTitle('Otwórz'));

    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'owner@tenant.testZweryfikowana w SES',
      'tenant.testZweryfikowana w SESDKIM zweryfikowany',
      'old.tenant.testDKIM oczekuje',
    ]);
  }, 15_000);

  it('keeps the DNS shortcut hidden for a verified e-mail identity', async () => {
    server.use(
      http.get('/api/marketing/ses-settings', () => HttpResponse.json(unconfiguredSender)),
      http.get('/api/marketing/reputation', () => HttpResponse.json(reputation)),
      http.get('/api/marketing/ses-onboarding/identities', () => HttpResponse.json({
        ok: true,
        data: {
          identities: [{ identity: 'owner@tenant.test', kind: 'email', verified: true, dkimVerified: true }],
          accessDeniedAction: null,
        },
      })),
    );
    const user = userEvent.setup();
    renderWithProviders(<EmailTab />);

    await user.type(await screen.findByLabelText('Zweryfikowana domena lub adres'), 'owner@tenant.test');

    expect(screen.queryByText(/Domena jest już zweryfikowana w SES/)).not.toBeInTheDocument();
  }, 15_000);

  it('names the denied AWS action instead of failing the form', async () => {
    server.use(
      http.get('/api/marketing/ses-settings', () => HttpResponse.json(unconfiguredSender)),
      http.get('/api/marketing/reputation', () => HttpResponse.json(reputation)),
      http.get('/api/marketing/ses-onboarding/identities', () => HttpResponse.json({
        ok: true,
        data: { identities: [], accessDeniedAction: 'ses:GetIdentityDkimAttributes' },
      })),
    );
    renderWithProviders(<EmailTab />);

    expect(await screen.findByText(/Dodaj uprawnienie ses:GetIdentityDkimAttributes/)).toBeInTheDocument();
  }, 15_000);
});
