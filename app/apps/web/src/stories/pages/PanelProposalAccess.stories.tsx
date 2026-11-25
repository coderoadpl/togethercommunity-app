import type { Meta, StoryObj } from '@storybook/react-vite';
import recorded from '../fixtures/panel-products.json';
import { ACCESS_GROUP_ID, accessChangeProposalGroup, pendingAccessChangeProposals } from '../../test/change-proposal-fixtures.js';
import { fixtureKey } from '../fixture-key.js';
import { withPage } from '../page-decorators.js';

const fixture = {
  ...recorded,
  scenario: 'panel-proposal-access',
  route: '/panel/proposals',
  calls: {
    ...recorded.calls,
    [fixtureKey('getChangeProposalSummary', [])]: { ok: true, value: { pending: pendingAccessChangeProposals.length, pendingGroups: 1, hasProposals: true } },
    [fixtureKey('listChangeProposals', [{ status: 'pending', limit: 100 }])]: { ok: true, value: { proposals: pendingAccessChangeProposals, nextCursor: null, hasMore: false } },
    [fixtureKey('getChangeProposalGroup', [{ id: ACCESS_GROUP_ID }])]: { ok: true, value: { group: accessChangeProposalGroup } },
  },
};
const meta = { title: 'Pages/PanelProposalAccess', id: 'panel-proposal-access', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'en', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'panel-proposal-access--shadcn--desktop', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'panel-proposal-access--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };
export const ShadcnDesktopPolish: Story = { parameters: { __id: 'panel-proposal-access--shadcn--desktop-polish', locale: 'pl', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobilePolish: Story = { parameters: { __id: 'panel-proposal-access--shadcn--mobile-polish', locale: 'pl', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };
