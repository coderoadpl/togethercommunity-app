import type { Meta, StoryObj } from '@storybook/react-vite';
import { z } from 'zod';

import { tenantSchema, tenantSettingsSchema, marketingSignupFormSchema } from '#core/domain/index.js';
import brandFixture from '../../web/src/stories/fixtures/marketing-preferences.json';
import fixture from '../../web/src/stories/fixtures/panel-marketing-forms.json';
import { publicMarketingMessagesPl } from './public-marketing-pages.pl.js';
import { renderSignupFormPage } from './public-marketing-pages.js';

const brand = z.object({ brand: z.object({ tenant: tenantSchema, settings: tenantSettingsSchema.nullable() }) }).parse(brandFixture).brand;
const form = marketingSignupFormSchema.parse(fixture.calls['listMarketingSignupForms:[{}]'].value.forms[0]?.form);
const meta = {
  title: 'Pages/MarketingSignupForm', id: 'marketing-signup-form', parameters: { layout: 'fullscreen', serverHtml: true, locale: 'en' },
  args: { thanks: false, doubleOptIn: true, colorScheme: 'light', language: 'en' },
  render: ({ thanks, doubleOptIn, colorScheme, language }) => <iframe title="Newsletter signup" srcDoc={renderSignupFormPage({ nonce: '', brand, language, form: { ...form, successText: { ...form.successText, pl: publicMarketingMessagesPl.signupThanks } }, wording: form.consentVersion.label, thanks, doubleOptIn }).replaceAll('@media(prefers-color-scheme:dark)', colorScheme === 'dark' ? '@media all' : '@media not all')} style={{ colorScheme, display: 'block', border: 0, width: '100vw', height: '100vh' }} />,
} satisfies Meta<{ thanks: boolean; doubleOptIn: boolean; colorScheme: 'light' | 'dark'; language: 'en' | 'pl' }>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Desktop: Story = { parameters: { __id: 'marketing-signup-form--shadcn--desktop' }, globals: { viewport: { value: 'desktop' } } };
export const Mobile: Story = { parameters: { __id: 'marketing-signup-form--shadcn--mobile' }, globals: { viewport: { value: 'mobile' } } };
export const ThanksDesktop: Story = { args: { thanks: true }, parameters: { __id: 'marketing-signup-thanks--shadcn--desktop' }, globals: { viewport: { value: 'desktop' } } };
export const ThanksMobile: Story = { args: { thanks: true }, parameters: { __id: 'marketing-signup-thanks--shadcn--mobile' }, globals: { viewport: { value: 'mobile' } } };
export const DarkDesktop: Story = { args: { colorScheme: 'dark' }, globals: { viewport: { value: 'desktop' } } };
export const DarkMobile: Story = { args: { colorScheme: 'dark' }, globals: { viewport: { value: 'mobile' } } };
export const Pending: Story = { args: { thanks: true }, globals: { viewport: { value: 'mobile' } } };
export const Subscribed: Story = { args: { thanks: true, doubleOptIn: false }, globals: { viewport: { value: 'desktop' } } };

export const Polish: Story = { args: { language: 'pl' }, globals: { viewport: { value: 'mobile' } } };
