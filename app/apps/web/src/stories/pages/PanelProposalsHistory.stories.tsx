import type { Meta, StoryObj } from '@storybook/react-vite';
import recorded from '../fixtures/panel-products.json';
import { historyChangeProposals, historyDetail } from '../../test/change-proposal-fixtures.js';
import { fixtureKey } from '../fixture-key.js';
import { withPage } from '../page-decorators.js';

const fixture = {
  ...recorded,
  scenario: 'panel-proposals-history',
  route: '/panel/proposals#history',
  calls: {
    ...recorded.calls,
    [fixtureKey('getChangeProposalSummary', [])]: { ok: true, value: { pending: 0, pendingGroups: 0 } },
    [fixtureKey('listChangeProposals', [{ limit: 50 }])]: { ok: true, value: { proposals: historyChangeProposals, nextCursor: null } },
    ...Object.fromEntries(historyChangeProposals.map((proposal) => [
      fixtureKey('getChangeProposal', [{ id: proposal.id }]),
      { ok: true, value: { proposal: historyDetail(proposal) } },
    ])),
  },
};
const meta = { title: 'Pages/PanelProposalsHistory', id: 'panel-proposals-history', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'en', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'panel-proposals-history--shadcn--desktop', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'panel-proposals-history--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };
