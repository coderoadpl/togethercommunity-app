import type { Meta, StoryObj } from '@storybook/react-vite';

import visitorFixture from '../fixtures/anon-home-tiles.json';
import { withPage } from '../page-decorators.js';

const fixture = {
  ...visitorFixture,
  calls: {
    ...visitorFixture.calls,
    'me:[]': {
      ok: true,
      value: {
        userId: 'visitor-1',
        email: 'alex.member@example.test',
        name: 'Alex Member',
        emailVerified: true,
        tenantAccess: 'none',
        tenant: null,
      },
    },
  },
};

const meta = {
  title: 'Pages/ForeignTenantVisitor',
  render: () => <></>,
  decorators: [withPage],
  parameters: { fixture, locale: 'en', layout: 'fullscreen' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const EnglishLight: Story = { parameters: { locale: 'en', colorScheme: 'light' } };
export const EnglishDark: Story = { parameters: { locale: 'en', colorScheme: 'dark' } };
export const PolishLight: Story = { parameters: { locale: 'pl', colorScheme: 'light' } };
export const PolishDark: Story = { parameters: { locale: 'pl', colorScheme: 'dark' } };
export const EnglishLightMobile: Story = { parameters: { locale: 'en', colorScheme: 'light' }, globals: { viewport: { value: 'mobile' } } };
export const EnglishDarkMobile: Story = { parameters: { locale: 'en', colorScheme: 'dark' }, globals: { viewport: { value: 'mobile' } } };
export const PolishLightMobile: Story = { parameters: { locale: 'pl', colorScheme: 'light' }, globals: { viewport: { value: 'mobile' } } };
export const PolishDarkMobile: Story = { parameters: { locale: 'pl', colorScheme: 'dark' }, globals: { viewport: { value: 'mobile' } } };
