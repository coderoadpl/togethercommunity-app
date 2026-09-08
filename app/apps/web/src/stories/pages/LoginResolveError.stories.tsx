import { userEvent, within } from 'storybook/test';
import type { Meta, StoryObj } from '@storybook/react-vite';
import fixture from '../fixtures/login.json';
import { withPage } from '../page-decorators.js';

const resolveCall = 'resolveSignInMethods:[{"email":"creator@together.dev"}]';
const errorFixture = {
  ...fixture,
  calls: {
    ...fixture.calls,
    [resolveCall]: {
      ok: false,
      error: { code: 'unavailable', message: 'Service unavailable' },
    },
  },
  expectedErrors: { [resolveCall]: 'unavailable' },
};

const meta = { title: 'Pages/LoginResolveError', id: 'login-resolve-error', render: () => <></>, decorators: [withPage], parameters: { fixture: errorFixture, locale: 'pl', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const ShadcnMobile: Story = {
  parameters: { __id: 'login-resolve-error--shadcn--mobile', viewport: { defaultViewport: 'mobile' } },
  globals: { viewport: { value: 'mobile' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(await canvas.findByTestId('login-email'), 'creator@together.dev');
    await userEvent.click(canvas.getByTestId('login-continue'));
    await canvas.findByTestId('sign-in-methods-unavailable');
  },
};
