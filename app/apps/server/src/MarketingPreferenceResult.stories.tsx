import type { Meta, StoryObj } from '@storybook/react-vite';
import { z } from 'zod';
import { tenantSchema, tenantSettingsSchema } from '#core/domain/index.js';
import fixture from '../../web/src/stories/fixtures/marketing-preferences.json';
import { renderPreferenceResultPage } from './public-marketing-pages.js';

const input = z.object({ nonce: z.string(), brand: z.object({ tenant: tenantSchema, settings: tenantSettingsSchema.nullable() }), language: z.enum(['pl', 'en']), token: z.string(), scopeLabel: z.string().nullable() }).parse(fixture);
const resultSchema = z.object({ result: z.enum(['saved', 'scope_unsubscribed', 'all_unsubscribed']), pendingConfirmations: z.number().int().nonnegative() });
const meta = {
  title: 'Pages/MarketingPreferenceResult',
  parameters: { layout: 'fullscreen', serverHtml: true, locale: 'pl' },
  args: { result: 'scope_unsubscribed', pendingConfirmations: 0 },
  render: (args) => <iframe title="Marketing preference result" srcDoc={renderPreferenceResultPage({ ...input, ...resultSchema.parse(args) })} style={{ display: 'block', border: 0, width: '100vw', height: '100vh' }} />,
} satisfies Meta<z.infer<typeof resultSchema>>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ScopeUnsubscribedDesktop: Story = { args: { result: 'scope_unsubscribed', pendingConfirmations: 0 }, globals: { viewport: { value: 'desktop' } } };
export const ScopeUnsubscribedMobile: Story = { args: { result: 'scope_unsubscribed', pendingConfirmations: 0 }, globals: { viewport: { value: 'mobile' } } };
export const AllUnsubscribedDesktop: Story = { args: { result: 'all_unsubscribed', pendingConfirmations: 0 }, globals: { viewport: { value: 'desktop' } } };
export const AllUnsubscribedMobile: Story = { args: { result: 'all_unsubscribed', pendingConfirmations: 0 }, globals: { viewport: { value: 'mobile' } } };
export const SavedDesktop: Story = { args: { result: 'saved', pendingConfirmations: 0 }, globals: { viewport: { value: 'desktop' } } };
export const SavedMobile: Story = { args: { result: 'saved', pendingConfirmations: 0 }, globals: { viewport: { value: 'mobile' } } };
export const PendingConfirmationDesktop: Story = { args: { result: 'saved', pendingConfirmations: 1 }, globals: { viewport: { value: 'desktop' } } };
export const PendingConfirmationMobile: Story = { args: { result: 'saved', pendingConfirmations: 1 }, globals: { viewport: { value: 'mobile' } } };
