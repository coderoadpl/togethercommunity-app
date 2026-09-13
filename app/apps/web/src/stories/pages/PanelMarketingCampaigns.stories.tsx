import type { Meta, StoryObj } from '@storybook/react-vite';
import type { z } from 'zod';
import type { marketingSesSettingsOutputSchema } from '#core/contract/index.js';
import audience from '../fixtures/panel-marketing-campaign-audience.json';
import fixture from '../fixtures/panel-marketing-campaigns.json';
import report from '../fixtures/panel-marketing-campaign-report.json';
import running from '../fixtures/panel-marketing-campaign-running.json';
import { withPage } from '../page-decorators.js';

const meta = { title: 'Pages/PanelMarketingCampaigns', id: 'panel-marketing-campaigns', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'en', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'panel-marketing-campaigns--shadcn--desktop', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'panel-marketing-campaigns--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };

export const ListAudience: Story = { parameters: { fixture: audience } };
export const ListAudienceEnglish: Story = { parameters: { fixture: audience, locale: 'en' } };

const pageStory = (scenario: unknown, colorScheme: 'light' | 'dark', viewport: 'desktop' | 'mobile'): Story => ({
  parameters: { fixture: scenario, colorScheme, viewport: { defaultViewport: viewport } },
  globals: { viewport: { value: viewport } },
});

const sendingSettings = (trackingEnabled: boolean): z.infer<typeof marketingSesSettingsOutputSchema> => ({
  credentialsConfigured: true,
  lastSnsDelivery: null,
  platformPool: { limit: 1000, used: 125 },
  resendConfigured: false,
  settings: {
    autoPauseOnCritical: false,
    broadcastsEnabled: true,
    configurationSet: 'tenant-marketing',
    footerAddress: '1 Example Street',
    footerLegalName: 'Example Ltd',
    fromAddress: 'news@example.org',
    fromName: 'Example',
    identity: 'example.org',
    identityCheckError: null,
    identityCheckedAt: '2026-07-01T12:00:00.000Z',
    identityVerifiedAt: '2026-07-01T12:00:00.000Z',
    inSandbox: false,
    quotaDaily: 50000,
    quotaRatePerSec: 14,
    quotaRefreshedAt: '2026-07-01T12:00:00.000Z',
    quotaSentLast24Hours: 300,
    replyTo: null,
    reputationAlertStatus: null,
    reputationAlertedAt: null,
    snsSubscriptionConfirmedAt: '2026-07-01T12:00:00.000Z',
    snsSubscriptionEndpoint: 'https://example.org/api/webhooks/ses/story-token',
    snsTopicArn: 'arn:aws:sns:eu-central-1:123456789012:tenant-marketing',
    tenantId: 'tenant-studio',
    trackingEnabled,
    webhookToken: 'story-webhook-token',
    webhookVerifiedAt: '2026-07-01T12:00:00.000Z',
  },
  smtpConfigured: false,
  webhookEndpointStale: false,
  webhookUrl: 'https://example.org/api/webhooks/ses/story-token',
});

const campaignAudienceWithTracking = (trackingEnabled: boolean) => ({
  ...audience,
  calls: {
    ...audience.calls,
    'getMarketingSesSettings:[]': { ok: true, value: sendingSettings(trackingEnabled) },
  },
});

export const RunningLightDesktop1440: Story = pageStory(running, 'light', 'desktop');
export const RunningLightMobile390: Story = pageStory(running, 'light', 'mobile');
export const RunningDarkDesktop1440: Story = pageStory(running, 'dark', 'desktop');
export const RunningDarkMobile390: Story = pageStory(running, 'dark', 'mobile');
export const FinishedWithBouncesLightDesktop1440: Story = pageStory(report, 'light', 'desktop');
export const FinishedWithBouncesLightMobile390: Story = pageStory(report, 'light', 'mobile');
export const FinishedWithBouncesDarkDesktop1440: Story = pageStory(report, 'dark', 'desktop');
export const FinishedWithBouncesDarkMobile390: Story = pageStory(report, 'dark', 'mobile');
export const ListCardLightDesktop1440: Story = pageStory(fixture, 'light', 'desktop');
export const ListCardLightMobile390: Story = pageStory(fixture, 'light', 'mobile');
export const ListCardDarkDesktop1440: Story = pageStory(fixture, 'dark', 'desktop');
export const ListCardDarkMobile390: Story = pageStory(fixture, 'dark', 'mobile');
const trackingDisabledForm = campaignAudienceWithTracking(false);
const trackingEnabledForm = campaignAudienceWithTracking(true);
export const FormTrackingDisabledLightDesktop1440: Story = pageStory(trackingDisabledForm, 'light', 'desktop');
export const FormTrackingDisabledLightMobile390: Story = pageStory(trackingDisabledForm, 'light', 'mobile');
export const FormTrackingDisabledDarkDesktop1440: Story = pageStory(trackingDisabledForm, 'dark', 'desktop');
export const FormTrackingDisabledDarkMobile390: Story = pageStory(trackingDisabledForm, 'dark', 'mobile');
export const FormTrackingEnabledLightDesktop1440: Story = pageStory(trackingEnabledForm, 'light', 'desktop');
export const FormTrackingEnabledLightMobile390: Story = pageStory(trackingEnabledForm, 'light', 'mobile');
export const FormTrackingEnabledDarkDesktop1440: Story = pageStory(trackingEnabledForm, 'dark', 'desktop');
export const FormTrackingEnabledDarkMobile390: Story = pageStory(trackingEnabledForm, 'dark', 'mobile');
