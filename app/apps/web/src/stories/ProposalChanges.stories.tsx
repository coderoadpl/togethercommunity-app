import { Paper } from '@mui/material';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ChangeProposalOwnerView } from '#core/domain/index.js';
import { ProposalFieldRows, type StockNow } from '../features/home/proposals/ProposalChanges.js';
import { groupReferences } from '../features/home/proposals/proposal-display.js';
import { changeProposalGroupItems } from '../test/change-proposal-fixtures.js';
import { withAccountPreview } from './page-decorators.js';

type Proposal = Pick<ChangeProposalOwnerView, 'effect' | 'input'>;

const Rows = ({ proposal, stockNow, inGroup = false }: { proposal: Proposal; stockNow?: StockNow; inGroup?: boolean }) => (
  <Paper elevation={1} sx={{ p: '1.5rem', maxWidth: '48rem' }}>
    <ProposalFieldRows
      proposal={proposal}
      stockNow={stockNow}
      {...(inGroup ? { references: groupReferences(changeProposalGroupItems) } : {})}
    />
  </Paper>
);

const text: Proposal = {
  input: {},
  effect: {
    title: { before: 'Scenario workshop', after: 'Scenario Workshop' },
    description: {
      before: null,
      after: 'A long description that the proposer wrote for the product page. '.repeat(8).trim(),
    },
  },
};
const money: Proposal = { input: { currency: 'PLN' }, effect: { priceCents: { before: 49900, after: 52900 } } };
const boolean: Proposal = { input: {}, effect: { published: { before: false, after: true } } };
const list: Proposal = {
  input: {},
  effect: {
    activePrices: {
      before: [{ kind: 'recurring', interval: 'month', amountCents: 4900, currency: 'PLN' }],
      after: [
        { kind: 'recurring', interval: 'month', amountCents: 4900, currency: 'PLN' },
        { kind: 'one_time', interval: null, amountCents: 19900, currency: 'PLN' },
      ],
    },
  },
};
const image: Proposal = {
  input: {},
  effect: {
    coverUrl: { before: 'https://images.example.org/old-cover.jpg', after: '/api/public/assets/product-cover/field-guide.webp' },
  },
};
const reference: Proposal = { input: {}, effect: { productIds: { before: null, after: ['$proposal:proposal-field-guide-product'] } } };
const unknown: Proposal = { input: {}, effect: { giftWrapping: { before: null, after: 'Recycled paper, red ribbon' } } };
const stockDelta: Proposal = { input: { productId: 'product-studio-workbook-print', delta: -3, reason: 'Damaged copies' }, effect: { onHand: { delta: -3 } } };
const [newProduct] = changeProposalGroupItems;
const settingsChoices: Proposal = {
  input: {},
  effect: {
    invoicingProvider: { before: 'ifirma', after: 'ksef' },
    ksefSubmissionMode: { before: 'automatic', after: 'manual' },
    invoiceVatRatePercent: { before: 8, after: 23 },
  },
};

const meta = { title: 'Panel/ProposalChanges', decorators: [withAccountPreview], parameters: { locale: 'en', colorScheme: 'light', layout: 'fullscreen' }, render: () => <Rows proposal={text} /> } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const TextValue: Story = {};
export const MoneyValue: Story = { render: () => <Rows proposal={money} /> };
export const BooleanValue: Story = { render: () => <Rows proposal={boolean} /> };
export const ListValue: Story = { render: () => <Rows proposal={list} /> };
export const ImageValue: Story = { render: () => <Rows proposal={image} /> };
export const ReferenceValue: Story = { render: () => <Rows proposal={reference} inGroup /> };
export const UnknownField: Story = { render: () => <Rows proposal={unknown} /> };
export const StockDelta: Story = { render: () => <Rows proposal={stockDelta} stockNow={{ tracked: true, onHand: 12 }} /> };
export const NewRecord: Story = { render: () => (newProduct === undefined ? <></> : <Rows proposal={newProduct} />) };
export const NewRecordPolishMobile: Story = { ...NewRecord, parameters: { locale: 'pl' }, globals: { viewport: { value: 'mobile' } } };
export const EnumeratedValues: Story = { render: () => <Rows proposal={settingsChoices} /> };
export const TextPolishMobile: Story = { parameters: { locale: 'pl' }, globals: { viewport: { value: 'mobile' } } };
export const TextDark: Story = { parameters: { colorScheme: 'dark' } };
