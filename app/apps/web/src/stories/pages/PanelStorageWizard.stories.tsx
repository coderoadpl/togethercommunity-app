import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import fixture from '../fixtures/panel-storage-wizard.json';
import { withPage } from '../page-decorators.js';

const meta = { title: 'Pages/PanelStorageWizard', id: 'panel-storage-wizard', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'pl', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const openConnectionStep = async (canvasElement: HTMLElement) => {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByTestId('storage-provider-minio'));
  await userEvent.click(await canvas.findByTestId('storage-provider-continue'));
  await canvas.findByTestId('storage-connection-step');
};

export const ShadcnDesktop: Story = { parameters: { __id: 'panel-storage-wizard--shadcn--desktop', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'panel-storage-wizard--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };
export const ConnectionDesktop: Story = {
  parameters: { __id: 'panel-storage-wizard-connection--shadcn--desktop', viewport: { defaultViewport: 'desktop' } },
  globals: { viewport: { value: 'desktop' } },
  play: async ({ canvasElement }) => openConnectionStep(canvasElement),
};
export const ConnectionMobile: Story = {
  parameters: { __id: 'panel-storage-wizard-connection--shadcn--mobile', viewport: { defaultViewport: 'mobile' } },
  globals: { viewport: { value: 'mobile' } },
  play: async ({ canvasElement }) => openConnectionStep(canvasElement),
};
