import type { Meta, StoryObj } from '@storybook/react-vite';
import audience from '../fixtures/panel-marketing-campaign-audience.json';
import fixture from '../fixtures/panel-marketing-campaigns.json';
import { withPage } from '../page-decorators.js';

const meta = { title: 'Pages/PanelMarketingCampaigns', id: 'panel-marketing-campaigns', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'pl', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'panel-marketing-campaigns--shadcn--desktop', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'panel-marketing-campaigns--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };

export const ListAudience: Story = { parameters: { fixture: audience } };
export const ListAudienceEnglish: Story = { parameters: { fixture: audience, locale: 'en' } };
