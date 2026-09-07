import type { Meta, StoryObj } from '@storybook/react-vite';
import fixture from '../fixtures/panel-settings-domains.json';
import { withPage } from '../page-decorators.js';

const meta = { title: 'Pages/PanelSettingsDomains', id: 'panel-settings-domains', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'pl', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'panel-settings-domains--shadcn--desktop', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'panel-settings-domains--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };
