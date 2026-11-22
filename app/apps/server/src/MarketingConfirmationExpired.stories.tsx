import type { Meta, StoryObj } from '@storybook/react-vite';
import { z } from 'zod';
import { tenantSchema, tenantSettingsSchema } from '#core/domain/index.js';
import fixture from '../../web/src/stories/fixtures/marketing-confirmation-expired.json';
import { renderConfirmationPage } from './public-marketing-pages.js';

const input = z.object({ nonce: z.string(), brand: z.object({ tenant: tenantSchema, settings: tenantSettingsSchema.nullable() }), language: z.enum(['pl', 'en']), path: z.string(), state: z.literal('expired') }).parse(fixture);
const forcedScheme = (html: string, scheme: 'light' | 'dark') =>
  html.replaceAll('@media(prefers-color-scheme:dark)', scheme === 'dark' ? '@media all' : '@media not all');
const variant = (title: string, state: Parameters<typeof renderConfirmationPage>[0], scheme: 'light' | 'dark' = 'light') =>
  <iframe title={title} srcDoc={forcedScheme(renderConfirmationPage(state), scheme)} style={{ colorScheme: scheme, display: 'block', border: 0, width: '100vw', height: '100vh' }} />;
const signupHref = (language: 'pl' | 'en') => `/marketing/forms/newsletter?lang=${language}`;
const meta = {
  title: 'Pages/MarketingConfirmationExpired',
  id: 'marketing-confirmation-expired',
  parameters: { layout: 'fullscreen', serverHtml: true, locale: 'pl' },
  render: () => <iframe title="marketing-confirmation-expired" srcDoc={renderConfirmationPage(input)} style={{ display: 'block', border: 0, width: '100vw', height: '100vh' }} />,
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'marketing-confirmation-expired--shadcn--desktop' }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'marketing-confirmation-expired--shadcn--mobile' }, globals: { viewport: { value: 'mobile' } } };
export const SignUpAgainMobile: Story = { render: () => <iframe title="marketing-confirmation-expired-sign-up-again" srcDoc={renderConfirmationPage({ ...input, signupHref: signupHref(input.language) })} style={{ display: 'block', border: 0, width: '100vw', height: '100vh' }} />, globals: { viewport: { value: 'mobile' } } };
export const PolishDesktop: Story = { render: () => variant('marketing-confirmation-expired-polish', { ...input, language: 'pl' }), globals: { viewport: { value: 'desktop' } } };
export const PolishSignUpAgainMobile: Story = { render: () => variant('marketing-confirmation-expired-polish-sign-up-again', { ...input, language: 'pl', signupHref: signupHref('pl') }), globals: { viewport: { value: 'mobile' } } };
export const DarkDesktop: Story = { render: () => variant('marketing-confirmation-expired-dark', input, 'dark'), globals: { viewport: { value: 'desktop' } } };
export const DarkSignUpAgainMobile: Story = { render: () => variant('marketing-confirmation-expired-dark-sign-up-again', { ...input, signupHref: signupHref(input.language) }, 'dark'), globals: { viewport: { value: 'mobile' } } };
