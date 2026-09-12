import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';

import fixture from '../fixtures/panel-marketing-forms.json';
import { withPage } from '../page-decorators.js';

const meta = { title: 'Pages/PanelMarketingForms', id: 'panel-marketing-forms', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'en', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const Desktop: Story = { parameters: { __id: 'panel-marketing-forms--shadcn--desktop', colorScheme: 'light' }, globals: { viewport: { value: 'desktop' } } };
export const Mobile: Story = { parameters: { __id: 'panel-marketing-forms--shadcn--mobile', colorScheme: 'light' }, globals: { viewport: { value: 'mobile' } } };
export const DarkDesktop: Story = { parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'desktop' } } };
export const DarkMobile: Story = { parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'mobile' } } };
export const Create: Story = { play: async ({ canvasElement }) => { await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Create form' })); } };
export const Edit: Story = { play: async ({ canvasElement }) => { await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Edit form' })); } };
export const Embed: Story = { play: async ({ canvasElement }) => { await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Embed' })); } };

export const Polish: Story = { parameters: { locale: 'pl' }, globals: { viewport: { value: 'mobile' } } };
