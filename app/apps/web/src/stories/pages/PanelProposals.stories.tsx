import type { Meta, StoryObj } from '@storybook/react-vite';
import recorded from '../fixtures/panel-products.json';
import { CHANGE_PROPOSAL_GROUP_ID, STOCK_PRODUCT_ID, changeProposalGroup, pendingChangeProposals } from '../../test/change-proposal-fixtures.js';
import { fixtureKey } from '../fixture-key.js';
import { withPage } from '../page-decorators.js';

const fixture = {
  ...recorded,
  scenario: 'panel-proposals',
  route: '/panel/proposals',
  calls: {
    ...recorded.calls,
    [fixtureKey('getChangeProposalSummary', [])]: { ok: true, value: { pending: 7, pendingGroups: 1 } },
    [fixtureKey('listChangeProposals', [{ status: 'pending', limit: 100 }])]: { ok: true, value: { proposals: pendingChangeProposals, nextCursor: null } },
    [fixtureKey('getChangeProposalGroup', [{ id: CHANGE_PROPOSAL_GROUP_ID }])]: { ok: true, value: { group: changeProposalGroup } },
    [fixtureKey('getProductStock', [STOCK_PRODUCT_ID])]: {
      ok: true,
      value: {
        stock: {
          productId: STOCK_PRODUCT_ID,
          onHand: 12,
          reserved: 2,
          available: 10,
          lowStockThreshold: 5,
          lowStockNotifiedAt: null,
          low: false,
          soldOut: false,
          updatedAt: '2026-11-19T15:00:00.000Z',
        },
      },
    },
  },
};
const meta = { title: 'Pages/PanelProposals', id: 'panel-proposals', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'en', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'panel-proposals--shadcn--desktop', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'panel-proposals--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };
export const ShadcnDesktopPolish: Story = { parameters: { __id: 'panel-proposals--shadcn--desktop-polish', locale: 'pl', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
