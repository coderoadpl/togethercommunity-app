import type { Meta, StoryObj } from '@storybook/react-vite';
import recorded from '../fixtures/panel-settings-security.json';
import { withPage } from '../page-decorators.js';

const team = recorded.calls['listTenantTeam:[]'];
const fixture = {
  ...recorded,
  route: '/panel/settings#team',
  calls: {
    ...recorded.calls,
    'listTenantTeam:[]': {
      ...team,
      value: {
        members: [
          ...team.value.members,
          { userId: 'invitation-pending-admin', email: 'invited.admin@example.org', name: null, role: 'admin', status: 'invited' },
        ],
      },
    },
  },
};
const meta = { title: 'Pages/PanelSettingsTeam', id: 'panel-settings-team', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'en', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'panel-settings-team--shadcn--desktop', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'panel-settings-team--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };
