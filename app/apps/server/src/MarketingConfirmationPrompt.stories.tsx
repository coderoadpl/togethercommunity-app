import type { Meta, StoryObj } from '@storybook/react-vite';
import { z } from 'zod';
import { tenantSchema, tenantSettingsSchema } from '#core/domain/index.js';
import fixture from '../../web/src/stories/fixtures/marketing-confirmation-success.json';
import { renderConfirmationPage } from './public-marketing-pages.js';

const input = { ...z.object({ nonce: z.string(), brand: z.object({ tenant: tenantSchema, settings: tenantSettingsSchema.nullable() }), language: z.enum(['pl', 'en']), path: z.string() }).parse(fixture), state: 'prompt' as const };
const forcedScheme = (html: string, scheme: 'light' | 'dark') =>
  html.replaceAll('@media(prefers-color-scheme:dark)', scheme === 'dark' ? '@media all' : '@media not all');
const meta = {
  title: 'Pages/MarketingConfirmationPrompt',
  id: 'marketing-confirmation-prompt',
  parameters: { layout: 'fullscreen', serverHtml: true, locale: 'en' },
  args: { language: 'en', colorScheme: 'light' },
  render: ({ language, colorScheme }) => <iframe title="marketing-confirmation-prompt" srcDoc={forcedScheme(renderConfirmationPage({ ...input, language }), colorScheme)} style={{ colorScheme, display: 'block', border: 0, width: '100vw', height: '100vh' }} />,
} satisfies Meta<{ language: 'en' | 'pl'; colorScheme: 'light' | 'dark' }>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Desktop: Story = { globals: { viewport: { value: 'desktop' } } };
export const Mobile: Story = { globals: { viewport: { value: 'mobile' } } };
export const PolishDesktop: Story = { args: { language: 'pl' }, globals: { viewport: { value: 'desktop' } } };
export const PolishMobile: Story = { args: { language: 'pl' }, globals: { viewport: { value: 'mobile' } } };
export const DarkDesktop: Story = { args: { colorScheme: 'dark' }, globals: { viewport: { value: 'desktop' } } };
export const DarkMobile: Story = { args: { colorScheme: 'dark' }, globals: { viewport: { value: 'mobile' } } };
