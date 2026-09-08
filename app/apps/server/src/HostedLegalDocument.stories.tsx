import type { Meta, StoryObj } from '@storybook/react-vite';
import { z } from 'zod';
import { tenantSchema, tenantSettingsSchema } from '#core/domain/index.js';
import fixture from '../../web/src/stories/fixtures/hosted-legal-document.json';
import { renderLegalDocumentPage } from './public-marketing-pages.js';

const input = z.object({ nonce: z.string(), brand: z.object({ tenant: tenantSchema, settings: tenantSettingsSchema.nullable() }), language: z.enum(['pl', 'en']), path: z.string(), title: z.string(), content: z.string(), immutableVersion: z.object({ version: z.number(), publishedAt: z.string() }).nullable() }).parse(fixture);
const meta = {
  title: 'Pages/HostedLegalDocument',
  parameters: { layout: 'fullscreen', serverHtml: true, locale: 'pl' },
  render: () => <iframe title="Hosted legal document" srcDoc={renderLegalDocumentPage(input)} style={{ display: 'block', border: 0, width: '100vw', height: '100vh' }} />,
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const LightDesktop: Story = { globals: { viewport: { value: 'desktop' } } };
export const LightMobile: Story = { globals: { viewport: { value: 'mobile' } } };
