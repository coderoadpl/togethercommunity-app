import type { Meta, StoryObj } from '@storybook/react-vite';
import type { SyntheticEvent } from 'react';
import { z } from 'zod';
import { tenantSchema, tenantSettingsSchema } from '#core/domain/index.js';
import fixture from '../../web/src/stories/fixtures/hosted-legal-document.json';
import { renderHostedErrorPage, renderLegalDocumentPage } from './public-marketing-pages.js';

const input = z.object({ nonce: z.string(), brand: z.object({ tenant: tenantSchema, settings: tenantSettingsSchema.nullable() }), language: z.enum(['pl', 'en']), slug: z.string(), title: z.string(), content: z.string(), version: z.object({ version: z.number(), publishedAt: z.string() }), address: z.enum(['current', 'permanent']), latestVersion: z.number() }).parse(fixture);
const frame = (state: typeof input) => <iframe title="Hosted legal document" srcDoc={renderLegalDocumentPage(state)} style={{ display: 'block', border: 0, width: '100vw', height: '100vh' }} />;
const fitToDocument = ({ currentTarget }: SyntheticEvent<HTMLIFrameElement>) => {
  const fit = () => {
    const root = currentTarget.contentDocument?.documentElement;
    if (root !== undefined) currentTarget.style.height = `${String(root.scrollHeight)}px`;
  };
  fit();
  void currentTarget.contentDocument?.fonts.ready.then(fit);
};
const forcedScheme = (html: string, scheme: 'light' | 'dark') =>
  html.replaceAll('@media(prefers-color-scheme:dark)', scheme === 'dark' ? '@media all' : '@media not all');
const fittedFrame = (title: string, html: string, scheme: 'light' | 'dark' = 'light') => <iframe title={title} srcDoc={forcedScheme(html, scheme)} onLoad={fitToDocument} style={{ colorScheme: scheme, display: 'block', border: 0, width: '100%', height: '100vh' }} />;
const fittedDocument = (state: typeof input, scheme: 'light' | 'dark' = 'light') => fittedFrame('Hosted legal document', renderLegalDocumentPage(state), scheme);
const meta = {
  title: 'Pages/HostedLegalDocument',
  parameters: { layout: 'fullscreen', serverHtml: true, locale: 'pl' },
  render: () => frame(input),
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const LightDesktop: Story = { globals: { viewport: { value: 'desktop' } } };
export const LightMobile: Story = { globals: { viewport: { value: 'mobile' } } };
export const CurrentAddressDesktop: Story = { render: () => fittedDocument({ ...input, address: 'current' }), globals: { viewport: { value: 'desktop' } } };
export const OlderVersionMobile: Story = { render: () => fittedDocument({ ...input, latestVersion: input.version.version + 1 }), globals: { viewport: { value: 'mobile' } } };
export const PolishDesktop: Story = { render: () => fittedDocument({ ...input, language: 'pl' }), globals: { viewport: { value: 'desktop' } } };
export const MissingDocumentMobile: Story = { render: () => fittedFrame('Hosted legal document missing', renderHostedErrorPage({ ...input, path: null, kind: 'document_not_found' })), globals: { viewport: { value: 'mobile' } } };
export const DarkDesktop: Story = { render: () => fittedDocument(input, 'dark'), globals: { viewport: { value: 'desktop' } } };
export const DarkMobile: Story = { render: () => fittedDocument(input, 'dark'), globals: { viewport: { value: 'mobile' } } };
