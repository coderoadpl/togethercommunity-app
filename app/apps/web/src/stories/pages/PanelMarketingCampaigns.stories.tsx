import type { Meta, StoryObj } from '@storybook/react-vite';
import audience from '../fixtures/panel-marketing-campaign-audience.json';
import fixture from '../fixtures/panel-marketing-campaigns.json';
import activity from '../fixtures/panel-marketing-activity.json';
import { withPage } from '../page-decorators.js';

const meta = { title: 'Pages/PanelMarketingCampaigns', id: 'panel-marketing-campaigns', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'en', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'panel-marketing-campaigns--shadcn--desktop', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'panel-marketing-campaigns--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };

export const ListAudience: Story = { parameters: { fixture: audience } };
export const ListAudienceEnglish: Story = { parameters: { fixture: audience, locale: 'en' } };

const detailKey = 'getMarketingCampaign:["campaign-list-audience"]';
const runsKey = 'listTenantSchedulerRuns:[{"campaignId":"campaign-list-audience","limit":100}]';
const activityKey = 'listTenantSchedulerRuns:[{"limit":25}]';
const reportFixture = (status: 'running' | 'finished' | 'cancelled', trackingOff = false) => {
  const baseCampaign = audience.calls[detailKey].value.campaign;
  return {
    ...audience,
    calls: {
      ...audience.calls,
      [detailKey]: {
        ok: true,
        value: {
          campaign: {
            ...baseCampaign,
            audience: baseCampaign.audience === null ? null : { ...baseCampaign.audience, includeMembersWithConsent: true },
            status,
            sendAt: '2026-07-01T09:00:00.000Z',
            startedAt: '2026-07-01T09:00:00.000Z',
            finishedAt: status === 'finished' ? '2026-07-01T09:36:00.000Z' : null,
            engagement: trackingOff
              ? { uniqueOpens: 0, totalOpens: 0, uniqueClicks: 0, totalClicks: 0 }
              : { uniqueOpens: 48, totalOpens: 72, uniqueClicks: 16, totalClicks: 24 },
            results: { candidates: 100, waiting: status === 'running' ? 18 : 0, sent: 76, failed: 2, skipped: 4, delivered: 68, bounced: 6, complained: 2, unresolved: 0 },
          },
        },
      },
      'getMarketingSesSettings:[]': fixture.calls['getMarketingSesSettings:[]'],
      [runsKey]: {
        ok: true,
        value: {
          ...activity.calls[activityKey].value,
          items: activity.calls[activityKey].value.items.slice(0, 1).map((item) => ({
            ...item,
            campaignCounts: { sent: 1, failed: 0, skipped: 0 },
          })),
          nextCursor: null,
        },
      },
    },
  };
};

const reportStory = (status: 'running' | 'finished' | 'cancelled', colorScheme: 'light' | 'dark', viewport: 'desktop' | 'mobile', trackingOff = false): Story => ({
  parameters: { fixture: reportFixture(status, trackingOff), colorScheme, viewport: { defaultViewport: viewport } },
  globals: { viewport: { value: viewport } },
});

export const RunningLightDesktop1440: Story = reportStory('running', 'light', 'desktop');
export const RunningLightMobile390: Story = reportStory('running', 'light', 'mobile');
export const RunningDarkDesktop1440: Story = reportStory('running', 'dark', 'desktop');
export const RunningDarkMobile390: Story = reportStory('running', 'dark', 'mobile');
export const FinishedWithBouncesLightDesktop1440: Story = reportStory('finished', 'light', 'desktop');
export const FinishedWithBouncesLightMobile390: Story = reportStory('finished', 'light', 'mobile');
export const FinishedWithBouncesDarkDesktop1440: Story = reportStory('finished', 'dark', 'desktop');
export const FinishedWithBouncesDarkMobile390: Story = reportStory('finished', 'dark', 'mobile');
export const CancelledLightDesktop1440: Story = reportStory('cancelled', 'light', 'desktop');
export const CancelledLightMobile390: Story = reportStory('cancelled', 'light', 'mobile');
export const CancelledDarkDesktop1440: Story = reportStory('cancelled', 'dark', 'desktop');
export const CancelledDarkMobile390: Story = reportStory('cancelled', 'dark', 'mobile');
export const TrackingOffLightDesktop1440: Story = reportStory('finished', 'light', 'desktop', true);
export const TrackingOffLightMobile390: Story = reportStory('finished', 'light', 'mobile', true);
export const TrackingOffDarkDesktop1440: Story = reportStory('finished', 'dark', 'desktop', true);
export const TrackingOffDarkMobile390: Story = reportStory('finished', 'dark', 'mobile', true);
export const ListCardLightDesktop1440: Story = { parameters: { fixture, colorScheme: 'light' }, globals: { viewport: { value: 'desktop' } } };
export const ListCardLightMobile390: Story = { parameters: { fixture, colorScheme: 'light' }, globals: { viewport: { value: 'mobile' } } };
export const ListCardDarkDesktop1440: Story = { parameters: { fixture, colorScheme: 'dark' }, globals: { viewport: { value: 'desktop' } } };
export const ListCardDarkMobile390: Story = { parameters: { fixture, colorScheme: 'dark' }, globals: { viewport: { value: 'mobile' } } };
