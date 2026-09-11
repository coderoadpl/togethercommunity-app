import type { Meta, StoryObj } from '@storybook/react-vite';
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
