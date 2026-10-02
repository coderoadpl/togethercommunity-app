import type { Meta, StoryObj } from '@storybook/react-vite';
import fixture from '../fixtures/login.json';
import { withPage } from '../page-decorators.js';

const meta = { title: 'Pages/LoginTenant', id: 'login-tenant', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'en', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'login-tenant--shadcn--desktop', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'login-tenant--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };

const noticeFixture = (text: string) => ({
  ...fixture,
  calls: {
    ...fixture.calls,
    'publicOffer:[]': {
      ...fixture.calls['publicOffer:[]'],
      value: {
        ...fixture.calls['publicOffer:[]'].value,
        tenant: {
          ...fixture.calls['publicOffer:[]'].value.tenant,
          signInNotice: { enabled: true, text },
        },
      },
    },
  },
});

export const ShortNotice: Story = {
  parameters: { fixture: noticeFixture('Welcome to our new community. Use your existing email address to sign in.') },
};
export const LongNotice: Story = {
  parameters: { fixture: noticeFixture(('Welcome to our new community. Your courses and discussions are ready here.\nUse your existing email address to request a sign-in link.\n').repeat(4)) },
};
export const LongNoticePolish: Story = { ...LongNotice, parameters: { ...LongNotice.parameters, locale: 'pl' } };
export const ShortNoticePolish: Story = { ...ShortNotice, parameters: { ...ShortNotice.parameters, locale: 'pl' } };
export const NoticeDark: Story = { ...LongNotice, parameters: { ...LongNotice.parameters, colorScheme: 'dark' } };
export const NoticeMobile: Story = { ...LongNotice, globals: { viewport: { value: 'mobile' } } };
export const NoticeMobileDarkPolish: Story = {
  ...LongNoticePolish,
  parameters: { ...LongNoticePolish.parameters, colorScheme: 'dark' },
  globals: { viewport: { value: 'mobile' } },
};
