import type { Meta, StoryObj } from '@storybook/react-vite';
import fixture from '../fixtures/account.json';
import { withPage } from '../page-decorators.js';

const meta = { title: 'Pages/Account', id: 'account', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'pl', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'account--shadcn--desktop', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'account--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };
export const ShadcnMobile375: Story = { parameters: { __id: 'account--shadcn--mobile-375', viewport: { defaultViewport: 'mobile-375' } }, globals: { viewport: { value: 'mobile-375' } } };

export const Security: Story = { parameters: { fixture: { ...fixture, route: '/account?tab=security' } } };
export const Notifications: Story = { parameters: { fixture: { ...fixture, route: '/account?tab=notifications' } } };
const settingsCall = fixture.calls['getTenantSettings:[]'];
export const Playback: Story = {
  parameters: {
    docs: { description: { story: 'Synthetic tenant policy permits members to override video autoplay.' } },
    fixture: {
      ...fixture,
      route: '/account?tab=playback',
      calls: {
        ...fixture.calls,
        'getTenantSettings:[]': {
          ...settingsCall,
          value: { ...settingsCall.value, settings: { ...settingsCall.value.settings, memberVideoAutoplayOverride: true } },
        },
      },
    },
  },
};
