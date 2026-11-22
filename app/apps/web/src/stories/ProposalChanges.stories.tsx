import { Paper } from '@mui/material';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import type { ChangeProposalOwnerView } from '#core/domain/index.js';
import { ProposalFieldRows, type StockNow } from '../features/home/proposals/ProposalChanges.js';
import { groupReferences } from '../features/home/proposals/proposal-display.js';
import {
  changeProposalGroupItems,
  fileAddProposal,
  fileAddProposalOf,
  fileCopyProposal,
  fileLastRemoveProposal,
  fileRemoveProposal,
  fileReplaceProposal,
} from '../test/change-proposal-fixtures.js';
import { STORY_PROPOSAL_GONE_FILE_ID, STORY_PROPOSAL_IMAGE_DIGESTS } from './fixture-client.js';
import { withAccountPreview, withQueryClient } from './page-decorators.js';

type Proposal = Pick<ChangeProposalOwnerView, 'effect' | 'input'> & Partial<Pick<ChangeProposalOwnerView, 'proposedFiles'>>;

const Rows = ({ proposal, stockNow, inGroup = false, pendingProposalId = null }: { proposal: Proposal; stockNow?: StockNow; inGroup?: boolean; pendingProposalId?: string | null }) => (
  <Paper elevation={1} sx={{ p: '1.5rem', maxWidth: '48rem' }}>
    <ProposalFieldRows
      proposal={proposal}
      stockNow={stockNow}
      pendingProposalId={pendingProposalId}
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
const proposedCoverOf = (digest: string): Proposal => ({
  input: {},
  effect: {
    coverUrl: {
      before: '/api/public/assets/product-cover/field-guide.webp',
      after: `/api/public/assets/product-cover/${digest}.png`,
    },
  },
});
const proposedCover = proposedCoverOf(STORY_PROPOSAL_IMAGE_DIGESTS.previewable);
const unreadableCover = proposedCoverOf(STORY_PROPOSAL_IMAGE_DIGESTS.unreadable);
const proposedSvgLogo: Proposal = {
  input: {},
  effect: { logoUrl: { before: null, after: '/api/public/assets/logo/9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b.svg' } },
};
const reference: Proposal = { input: {}, effect: { productIds: { before: null, after: ['$proposal:proposal-field-guide-product'] } } };
const unknown: Proposal = { input: {}, effect: { giftWrapping: { before: null, after: 'Recycled paper, red ribbon' } } };
const stockDelta: Proposal = { input: { productId: 'product-studio-workbook-print', delta: -3, reason: 'Damaged copies' }, effect: { onHand: { delta: -3 } } };
const [newProduct] = changeProposalGroupItems;
const goneFile = fileAddProposalOf(STORY_PROPOSAL_GONE_FILE_ID, 'workbook-answers.epub');
const settingsChoices: Proposal = {
  input: {},
  effect: {
    invoicingProvider: { before: 'ifirma', after: 'ksef' },
    ksefSubmissionMode: { before: 'automatic', after: 'manual' },
    invoiceVatRatePercent: { before: 8, after: 23 },
  },
};

const meta = { title: 'Panel/ProposalChanges', decorators: [withQueryClient, withAccountPreview], parameters: { locale: 'en', colorScheme: 'light', layout: 'fullscreen' }, render: () => <Rows proposal={text} /> } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const TextValue: Story = {};
export const MoneyValue: Story = { render: () => <Rows proposal={money} /> };
export const BooleanValue: Story = { render: () => <Rows proposal={boolean} /> };
export const ListValue: Story = { render: () => <Rows proposal={list} /> };
export const ImageValue: Story = { render: () => <Rows proposal={image} /> };
export const ProposedImageAwaitingApproval: Story = { render: () => <Rows proposal={proposedCover} pendingProposalId="proposal-field-guide-cover" /> };
export const ProposedImagePolishMobile: Story = { ...ProposedImageAwaitingApproval, parameters: { locale: 'pl' }, globals: { viewport: { value: 'mobile' } } };
export const ProposedImageFailed: Story = { render: () => <Rows proposal={unreadableCover} pendingProposalId="proposal-field-guide-cover" /> };
export const ProposedImageFailedPolishMobile: Story = { ...ProposedImageFailed, parameters: { locale: 'pl' }, globals: { viewport: { value: 'mobile' } } };
export const ProposedSvgAwaitingApproval: Story = { render: () => <Rows proposal={proposedSvgLogo} pendingProposalId="proposal-studio-logo" /> };
export const ProposedSvgPolishMobile: Story = { ...ProposedSvgAwaitingApproval, parameters: { locale: 'pl' }, globals: { viewport: { value: 'mobile' } } };
export const ReferenceValue: Story = { render: () => <Rows proposal={reference} inGroup /> };
export const UnknownField: Story = { render: () => <Rows proposal={unknown} /> };
export const StockDelta: Story = { render: () => <Rows proposal={stockDelta} stockNow={{ tracked: true, onHand: 12 }} /> };
export const NewRecord: Story = { render: () => (newProduct === undefined ? <></> : <Rows proposal={newProduct} />) };
export const NewRecordPolishMobile: Story = { ...NewRecord, parameters: { locale: 'pl' }, globals: { viewport: { value: 'mobile' } } };
export const EnumeratedValues: Story = { render: () => <Rows proposal={settingsChoices} /> };
export const TextPolishMobile: Story = { parameters: { locale: 'pl' }, globals: { viewport: { value: 'mobile' } } };
export const ProposedFileUploaded: Story = { render: () => <Rows proposal={fileAddProposal} pendingProposalId={fileAddProposal.id} /> };
export const ProposedFileUploadedPolishMobile: Story = { ...ProposedFileUploaded, parameters: { locale: 'pl' }, globals: { viewport: { value: 'mobile' } } };
export const ProposedFileCopied: Story = { render: () => <Rows proposal={fileCopyProposal} pendingProposalId={fileCopyProposal.id} /> };
export const ProposedFileCopiedPolishMobile: Story = { ...ProposedFileCopied, parameters: { locale: 'pl' }, globals: { viewport: { value: 'mobile' } } };
export const ProposedFileVersion: Story = { render: () => <Rows proposal={fileReplaceProposal} pendingProposalId={fileReplaceProposal.id} /> };
export const ProposedFileVersionPolishMobile: Story = { ...ProposedFileVersion, parameters: { locale: 'pl' }, globals: { viewport: { value: 'mobile' } } };
export const ProposedFileRemoval: Story = { render: () => <Rows proposal={fileRemoveProposal} pendingProposalId={fileRemoveProposal.id} /> };
export const ProposedFileRemovalPolishMobile: Story = { ...ProposedFileRemoval, parameters: { locale: 'pl' }, globals: { viewport: { value: 'mobile' } } };
export const ProposedFileLastRemoval: Story = { render: () => <Rows proposal={fileLastRemoveProposal} pendingProposalId={fileLastRemoveProposal.id} /> };
export const ProposedFileLastRemovalPolishMobile: Story = { ...ProposedFileLastRemoval, parameters: { locale: 'pl' }, globals: { viewport: { value: 'mobile' } } };
export const ProposedFileGone: Story = {
  render: () => <Rows proposal={goneFile} pendingProposalId={goneFile.id} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByTestId('proposed-file-download'));
    await within(canvasElement).findByTestId('proposed-file-unavailable');
  },
};
export const ProposedFileGonePolishMobile: Story = { ...ProposedFileGone, parameters: { locale: 'pl' }, globals: { viewport: { value: 'mobile' } } };
export const TextDark: Story = { parameters: { colorScheme: 'dark' } };
