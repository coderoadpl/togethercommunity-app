import type { Meta, StoryObj } from '@storybook/react-vite';
import fixture from '../fixtures/panel-integrations-email.json';
import { withPage } from '../page-decorators.js';

const meta = { title: 'Pages/PanelIntegrationsEmail', id: 'panel-integrations-email', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'pl', layout: 'fullscreen', preloadFonts: false } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'panel-integrations-email--shadcn--desktop', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'panel-integrations-email--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };
