import type { Meta, StoryObj } from '@storybook/react-vite';
import { z } from 'zod';
import { tenantSchema, tenantSettingsSchema } from '#core/domain/index.js';
import fixture from '../../web/src/stories/fixtures/marketing-confirmation-success.json';
import { renderConfirmationPage } from './public-marketing-pages.js';

const input = z.object({ nonce: z.string(), brand: z.object({ tenant: tenantSchema, settings: tenantSettingsSchema.nullable() }), language: z.enum(['pl', 'en']), path: z.string(), state: z.literal('success') }).parse(fixture);
const forcedScheme = (html: string, scheme: 'light' | 'dark') =>
  html.replaceAll('@media(prefers-color-scheme:dark)', scheme === 'dark' ? '@media all' : '@media not all');
const variant = (title: string, state: Parameters<typeof renderConfirmationPage>[0], scheme: 'light' | 'dark' = 'light') =>
  <iframe title={title} srcDoc={forcedScheme(renderConfirmationPage(state), scheme)} style={{ colorScheme: scheme, display: 'block', border: 0, width: '100vw', height: '100vh' }} />;
const meta = {
  title: 'Pages/MarketingConfirmationSuccess',
  id: 'marketing-confirmation-success',
  parameters: { layout: 'fullscreen', serverHtml: true, locale: 'pl' },
  render: () => <iframe title="marketing-confirmation-success" srcDoc={renderConfirmationPage(input)} style={{ display: 'block', border: 0, width: '100vw', height: '100vh' }} />,
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'marketing-confirmation-success--shadcn--desktop' }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'marketing-confirmation-success--shadcn--mobile' }, globals: { viewport: { value: 'mobile' } } };
export const PolishDesktop: Story = { render: () => variant('marketing-confirmation-success-polish', { ...input, language: 'pl' }), globals: { viewport: { value: 'desktop' } } };
export const PolishMobile: Story = { render: () => variant('marketing-confirmation-success-polish', { ...input, language: 'pl' }), globals: { viewport: { value: 'mobile' } } };
export const DarkDesktop: Story = { render: () => variant('marketing-confirmation-success-dark', input, 'dark'), globals: { viewport: { value: 'desktop' } } };
export const DarkMobile: Story = { render: () => variant('marketing-confirmation-success-dark', input, 'dark'), globals: { viewport: { value: 'mobile' } } };
