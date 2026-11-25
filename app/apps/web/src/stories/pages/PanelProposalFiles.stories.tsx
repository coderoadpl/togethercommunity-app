import type { Meta, StoryObj } from '@storybook/react-vite';
import recorded from '../fixtures/panel-products.json';
import { FILE_GROUP_ID, fileChangeProposalGroup, pendingFileChangeProposals } from '../../test/change-proposal-fixtures.js';
import { fixtureKey } from '../fixture-key.js';
import { withPage } from '../page-decorators.js';

const fixture = {
  ...recorded,
  scenario: 'panel-proposal-files',
  route: '/panel/proposals',
  calls: {
    ...recorded.calls,
    [fixtureKey('getChangeProposalSummary', [])]: { ok: true, value: { pending: pendingFileChangeProposals.length, pendingGroups: 1, hasProposals: true } },
    [fixtureKey('listChangeProposals', [{ status: 'pending', limit: 100 }])]: { ok: true, value: { proposals: pendingFileChangeProposals, nextCursor: null, hasMore: false } },
    [fixtureKey('getChangeProposalGroup', [{ id: FILE_GROUP_ID }])]: { ok: true, value: { group: fileChangeProposalGroup } },
  },
};
const meta = { title: 'Pages/PanelProposalFiles', id: 'panel-proposal-files', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'en', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'panel-proposal-files--shadcn--desktop', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'panel-proposal-files--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };
export const ShadcnDesktopPolish: Story = { parameters: { __id: 'panel-proposal-files--shadcn--desktop-polish', locale: 'pl', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
