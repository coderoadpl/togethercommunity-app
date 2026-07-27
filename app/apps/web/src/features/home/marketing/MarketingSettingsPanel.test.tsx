import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { MarketingSettingsPanel } from './MarketingSettingsPanel.js';

const now = '2026-07-27T10:00:00.000Z';

describe('SES onboarding wizard', () => {
  it('polls provider state, shows DKIM rows, and surfaces verification regression', async () => {
    server.use(
      http.get('/api/marketing/ses-settings', () => HttpResponse.json({
        ok: true,
        data: {
          credentialsConfigured: true,
          smtpConfigured: false,
          platformPool: { used: 25, limit: 1000 },
          webhookUrl: 'https://app.test/api/webhooks/ses/webhook-token',
          settings: {
            tenantId: 'tenant-1',
            fromAddress: 'news@tenant.test',
            fromName: 'Tenant',
            identity: 'tenant.test',
            identityVerifiedAt: now,
            configurationSet: 'together-tenant-1',
            snsTopicArn: 'arn:aws:sns:eu-central-1:123:together-tenant-1',
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
          },
        },
      })),
      http.get('/api/marketing/reputation', () => HttpResponse.json({
        ok: true,
        data: {
          windowStart: now,
          windowEnd: now,
          hardBounce: { count: 0, sends: 0, rate: null, status: 'insufficient_data' },
          complaint: { count: 0, sends: 0, rate: null, status: 'insufficient_data' },
          overallStatus: 'insufficient_data',
        },
      })),
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
    );
    const user = userEvent.setup();
    renderWithProviders(<MarketingSettingsPanel />);

    await user.click(await screen.findByRole('button', { name: 'Sprawdź status w AWS' }));

    expect(await screen.findByText(/AWS nie zgłasza już tej tożsamości/)).toBeInTheDocument();
    expect(screen.getByText(/token\._domainkey\.tenant\.test/)).toBeInTheDocument();
    expect(screen.getByText(/Przekazywanie powiadomień tożsamości jest wyłączone/)).toBeInTheDocument();
  });
});
