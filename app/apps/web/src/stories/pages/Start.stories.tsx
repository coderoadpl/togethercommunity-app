import type { Meta, StoryObj } from '@storybook/react-vite';
import acmeFixture from '../fixtures/acme-start.json';
import fixture from '../fixtures/start.json';
import { withPage } from '../page-decorators.js';

const meta = { title: 'Pages/Start', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'en', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const LightDesktop: Story = { parameters: { viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const LightMobile: Story = { parameters: { viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };
export const Acme: Story = { parameters: { fixture: acmeFixture } };
