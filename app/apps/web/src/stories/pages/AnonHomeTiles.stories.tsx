import type { Meta, StoryObj } from '@storybook/react-vite';
import fixture from '../fixtures/anon-home-tiles.json';
import { withPage } from '../page-decorators.js';

const meta = { title: 'Pages/AnonHomeTiles', id: 'anon-home-tiles', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'pl', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };
