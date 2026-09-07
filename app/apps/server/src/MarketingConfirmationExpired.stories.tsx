import type { Meta, StoryObj } from '@storybook/react-vite';
import { z } from 'zod';
import { tenantSchema, tenantSettingsSchema } from '#core/domain/index.js';
import fixture from '../../web/src/stories/fixtures/marketing-confirmation-expired.json';
import { renderConfirmationPage } from './public-marketing-pages.js';

const input = z.object({ nonce: z.string(), brand: z.object({ tenant: tenantSchema, settings: tenantSettingsSchema.nullable() }), language: z.enum(['pl', 'en']), path: z.string(), state: z.literal('expired') }).parse(fixture);
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
