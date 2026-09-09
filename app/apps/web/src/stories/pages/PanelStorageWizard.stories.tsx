import type { Meta, StoryObj } from '@storybook/react-vite';
import fixture from '../fixtures/panel-storage-wizard.json';
import { withPage } from '../page-decorators.js';

const meta = { title: 'Pages/PanelStorageWizard', id: 'panel-storage-wizard', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'en', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'panel-storage-wizard--shadcn--desktop', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'panel-storage-wizard--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };
