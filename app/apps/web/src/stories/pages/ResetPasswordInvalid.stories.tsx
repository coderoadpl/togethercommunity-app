import type { Meta, StoryObj } from '@storybook/react-vite';
import fixture from '../fixtures/reset-password-invalid.json';
import { withPage } from '../page-decorators.js';

const meta = { title: 'Pages/ResetPasswordInvalid', id: 'reset-password-invalid', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'pl', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'reset-password-invalid--shadcn--desktop', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'reset-password-invalid--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };
