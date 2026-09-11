import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import fixture from '../fixtures/panel-marketing-activity.json';
import { withPage } from '../page-decorators.js';

const meta = { title: 'Pages/PanelMarketingActivity', id: 'panel-marketing-activity', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'en', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'panel-marketing-activity--shadcn--desktop', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'panel-marketing-activity--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };

const activityStory = (colorScheme: 'light' | 'dark', viewport: 'desktop' | 'mobile', showIdle: boolean): Story => ({
  parameters: { colorScheme, viewport: { defaultViewport: viewport } },
  globals: { viewport: { value: viewport } },
  ...(showIdle ? { play: async ({ canvasElement }) => userEvent.click(await within(canvasElement).findByRole('switch', { name: 'Show idle runs' })) } : {}),
});

export const WithoutIdleLightDesktop1440: Story = activityStory('light', 'desktop', false);
export const WithoutIdleLightMobile390: Story = activityStory('light', 'mobile', false);
export const WithoutIdleDarkDesktop1440: Story = activityStory('dark', 'desktop', false);
export const WithoutIdleDarkMobile390: Story = activityStory('dark', 'mobile', false);
export const WithIdleLightDesktop1440: Story = activityStory('light', 'desktop', true);
export const WithIdleLightMobile390: Story = activityStory('light', 'mobile', true);
export const WithIdleDarkDesktop1440: Story = activityStory('dark', 'desktop', true);
export const WithIdleDarkMobile390: Story = activityStory('dark', 'mobile', true);
