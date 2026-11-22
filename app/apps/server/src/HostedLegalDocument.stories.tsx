import type { Meta, StoryObj } from '@storybook/react-vite';
import { z } from 'zod';
import { tenantSchema, tenantSettingsSchema } from '#core/domain/index.js';
import fixture from '../../web/src/stories/fixtures/hosted-legal-document.json';
import { renderHostedErrorPage, renderLegalDocumentPage } from './public-marketing-pages.js';

const input = z.object({ nonce: z.string(), brand: z.object({ tenant: tenantSchema, settings: tenantSettingsSchema.nullable() }), language: z.enum(['pl', 'en']), slug: z.string(), title: z.string(), content: z.string(), version: z.object({ version: z.number(), publishedAt: z.string() }), address: z.enum(['current', 'permanent']), latestVersion: z.number() }).parse(fixture);
const frame = (state: typeof input) => <iframe title="Hosted legal document" srcDoc={renderLegalDocumentPage(state)} style={{ display: 'block', border: 0, width: '100vw', height: '100vh' }} />;
const meta = {
  title: 'Pages/HostedLegalDocument',
  parameters: { layout: 'fullscreen', serverHtml: true, locale: 'pl' },
  render: () => frame(input),
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const LightDesktop: Story = { globals: { viewport: { value: 'desktop' } } };
export const LightMobile: Story = { globals: { viewport: { value: 'mobile' } } };
export const CurrentAddressDesktop: Story = { render: () => frame({ ...input, address: 'current' }), globals: { viewport: { value: 'desktop' } } };
export const OlderVersionMobile: Story = { render: () => frame({ ...input, latestVersion: input.version.version + 1 }), globals: { viewport: { value: 'mobile' } } };
export const PolishDesktop: Story = { render: () => frame({ ...input, language: 'pl' }), globals: { viewport: { value: 'desktop' } } };
export const MissingDocumentMobile: Story = { render: () => <iframe title="Hosted legal document missing" srcDoc={renderHostedErrorPage({ ...input, path: null, kind: 'document_not_found' })} style={{ display: 'block', border: 0, width: '100vw', height: '100vh' }} />, globals: { viewport: { value: 'mobile' } } };
