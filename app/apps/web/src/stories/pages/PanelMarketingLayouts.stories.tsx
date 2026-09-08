import type { Meta, StoryObj } from '@storybook/react-vite';
import fixture from '../fixtures/panel-marketing-layouts.json';
import { withPage } from '../page-decorators.js';

const meta = { title: 'Pages/PanelMarketingLayouts', id: 'panel-marketing-layouts', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'pl', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'panel-marketing-layouts--shadcn--desktop', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'panel-marketing-layouts--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };
