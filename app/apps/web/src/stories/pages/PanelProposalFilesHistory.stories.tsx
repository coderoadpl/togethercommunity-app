import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import recorded from '../fixtures/panel-products.json';
import { fileHistoryChangeProposals, fileHistoryDetail, fileUnavailableHistoryProposal } from '../../test/change-proposal-fixtures.js';
import { fixtureKey } from '../fixture-key.js';
import { withPage } from '../page-decorators.js';

const fixture = {
  ...recorded,
  scenario: 'panel-proposal-files-history',
  route: '/panel/proposals#history',
  calls: {
    ...recorded.calls,
    [fixtureKey('getChangeProposalSummary', [])]: { ok: true, value: { pending: 0, pendingGroups: 0, hasProposals: true } },
    [fixtureKey('listChangeProposals', [{ status: 'decided', limit: 50 }])]: { ok: true, value: { proposals: fileHistoryChangeProposals, nextCursor: null, hasMore: false } },
    ...Object.fromEntries(fileHistoryChangeProposals.map((proposal) => [
      fixtureKey('getChangeProposal', [{ id: proposal.id }]),
      { ok: true, value: { proposal: fileHistoryDetail(proposal) } },
    ])),
  },
};
const meta = {
  title: 'Pages/PanelProposalFilesHistory',
  id: 'panel-proposal-files-history',
  render: () => <></>,
  decorators: [withPage],
  parameters: { fixture, locale: 'en', layout: 'fullscreen' },
  play: async ({ canvasElement }) => {
    const row = await within(canvasElement.ownerDocument.body).findByTestId(`proposal-history-${fileUnavailableHistoryProposal.id}`);
    await userEvent.click(within(row).getByTestId('proposal-history-toggle'));
    await within(row).findByTestId('proposal-timeline');
  },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'panel-proposal-files-history--shadcn--desktop', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'panel-proposal-files-history--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };
