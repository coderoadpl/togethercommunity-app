import { expect, userEvent, within } from 'storybook/test';
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

export const Passwordless: Story = {
  parameters: {
    fixture: {
      ...fixture,
      calls: {
        ...fixture.calls,
        'resolveSignInMethods:[{"email":"creator@together.dev"}]': {
          ok: true,
          value: { methods: ['magic-link'] },
        },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(await canvas.findByTestId('login-email'), 'creator@together.dev');
    await userEvent.click(canvas.getByTestId('login-continue'));
    await canvas.findByTestId('send-magic-link');
    await expect(canvas.getByTestId('use-password')).not.toHaveAttribute('aria-disabled');
    await expect(canvas.getByTestId('signin-passkey')).not.toHaveAttribute('aria-disabled');
  },
};

export const PasswordlessPolish: Story = {
  ...Passwordless,
  parameters: { ...Passwordless.parameters, locale: 'pl' },
};

export const PasswordOnly: Story = {
  parameters: {
    fixture: {
      ...fixture,
      calls: {
        ...fixture.calls,
        'resolveSignInMethods:[{"email":"creator@together.dev"}]': {
          ok: true,
          value: { methods: ['password', 'magic-link'] },
        },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(await canvas.findByTestId('login-email'), 'creator@together.dev');
    await userEvent.click(canvas.getByTestId('login-continue'));
    await canvas.findByTestId('login-password');
    await expect(canvas.getByTestId('use-password')).not.toHaveAttribute('aria-disabled');
    await expect(canvas.getByTestId('signin-passkey')).not.toHaveAttribute('aria-disabled');
  },
};

export const PasswordOnlyPolish: Story = {
  ...PasswordOnly,
  parameters: { ...PasswordOnly.parameters, locale: 'pl' },
};

export const PasskeyOnly: Story = {
  parameters: {
    fixture: {
      ...fixture,
      calls: {
        ...fixture.calls,
        'resolveSignInMethods:[{"email":"creator@together.dev"}]': {
          ok: true,
          value: { methods: ['passkey', 'magic-link'] },
        },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(await canvas.findByTestId('login-email'), 'creator@together.dev');
    await userEvent.click(canvas.getByTestId('login-continue'));
    await canvas.findByTestId('send-magic-link');
    await expect(canvas.getByTestId('use-password')).not.toHaveAttribute('aria-disabled');
    await expect(canvas.getByTestId('signin-passkey')).not.toHaveAttribute('aria-disabled');
  },
};

export const PasskeyOnlyPolish: Story = {
  ...PasskeyOnly,
  parameters: { ...PasskeyOnly.parameters, locale: 'pl' },
};

export const PasswordlessMobile: Story = {
  ...Passwordless,
  parameters: { ...Passwordless.parameters, viewport: { defaultViewport: 'mobile' } },
  globals: { viewport: { value: 'mobile' } },
};
