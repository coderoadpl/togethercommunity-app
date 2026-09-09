import type { Meta, StoryObj } from '@storybook/react-vite';
import fixture from '../fixtures/panel-settings-redirects.json';
import { withPage } from '../page-decorators.js';

const meta = { title: 'Pages/PanelSettingsRedirects', id: 'panel-settings-redirects', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'en', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'panel-settings-redirects--shadcn--desktop', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'panel-settings-redirects--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };
