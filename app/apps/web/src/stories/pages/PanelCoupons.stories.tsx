import type { Meta, StoryObj } from '@storybook/react-vite';
import fixture from '../fixtures/panel-coupons.json';
import { withPage } from '../page-decorators.js';

const meta = { title: 'Pages/PanelCoupons', id: 'panel-coupons', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'pl', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'panel-coupons--shadcn--desktop', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'panel-coupons--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };
