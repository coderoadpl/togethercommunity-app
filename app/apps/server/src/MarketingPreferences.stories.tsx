import type { Meta, StoryObj } from '@storybook/react-vite';
import type { SyntheticEvent } from 'react';
import { z } from 'zod';
import { tenantSchema, tenantSettingsSchema } from '#core/domain/index.js';
import fixture from '../../web/src/stories/fixtures/marketing-preferences.json';
import { renderPreferencesPage } from './public-marketing-pages.js';

const input = z.object({ nonce: z.string(), brand: z.object({ tenant: tenantSchema, settings: tenantSettingsSchema.nullable() }), language: z.enum(['pl', 'en']), token: z.string(), email: z.string().email(), scope: z.string(), scopeLabel: z.string().nullable(), globallySuppressed: z.boolean(), definitions: z.array(z.object({ id: z.string(), label: z.string(), active: z.boolean(), pendingConfirmation: z.boolean() })) }).parse(fixture);
const frame = (state: typeof input) => <iframe title="marketing-preferences" srcDoc={renderPreferencesPage(state)} style={{ display: 'block', border: 0, width: '100vw', height: '100vh' }} />;
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
const fittedFrame = (state: typeof input, scheme: 'light' | 'dark' = 'light') => <iframe title="marketing-preferences" srcDoc={forcedScheme(renderPreferencesPage(state), scheme)} onLoad={fitToDocument} style={{ colorScheme: scheme, display: 'block', border: 0, width: '100%', height: '100vh' }} />;
const withdrawn = { ...input, definitions: input.definitions.map((definition) => ({ ...definition, active: false, pendingConfirmation: false })) };
const meta = {
  title: 'Pages/MarketingPreferences',
  id: 'marketing-preferences',
  parameters: { layout: 'fullscreen', serverHtml: true, locale: 'pl' },
  render: () => frame(input),
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'marketing-preferences--shadcn--desktop' }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'marketing-preferences--shadcn--mobile' }, globals: { viewport: { value: 'mobile' } } };
export const GloballyUnsubscribedMobile: Story = { render: () => fittedFrame({ ...withdrawn, globallySuppressed: true }), globals: { viewport: { value: 'mobile' } } };
export const ConsentWithdrawnDesktop: Story = { render: () => fittedFrame(withdrawn), globals: { viewport: { value: 'desktop' } } };
export const AllMarketingLinkMobile: Story = { render: () => fittedFrame({ ...input, scope: 'all_marketing', scopeLabel: null }), globals: { viewport: { value: 'mobile' } } };
export const PolishDesktop: Story = { render: () => fittedFrame({ ...input, language: 'pl' }), globals: { viewport: { value: 'desktop' } } };
export const DarkDesktop: Story = { render: () => fittedFrame(input, 'dark'), globals: { viewport: { value: 'desktop' } } };
export const DarkMobile: Story = { render: () => fittedFrame(input, 'dark'), globals: { viewport: { value: 'mobile' } } };
