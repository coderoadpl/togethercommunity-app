import { userEvent, within } from 'storybook/test';
import type { Meta, StoryObj } from '@storybook/react-vite';
import fixture from '../fixtures/login.json';
import { withPage } from '../page-decorators.js';

const meta = { title: 'Pages/Login', id: 'login', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'en', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'login--shadcn--desktop', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'login--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };

export const MethodCards: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(await canvas.findByTestId('login-email'), 'creator@together.dev');
    await userEvent.click(canvas.getByTestId('login-continue'));
    await canvas.findByTestId('login-password');
  },
};

export const MethodCardsMobile: Story = {
  ...MethodCards,
  parameters: { viewport: { defaultViewport: 'mobile' } },
  globals: { viewport: { value: 'mobile' } },
};
