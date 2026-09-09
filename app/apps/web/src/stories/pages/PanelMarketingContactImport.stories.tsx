import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import error from '../fixtures/panel-marketing-import-error.json';
import failed from '../fixtures/panel-marketing-contact-failed.json';
import cancelled from '../fixtures/panel-marketing-contact-cancelled.json';
import processing from '../fixtures/panel-marketing-contact-processing.json';
import completed from '../fixtures/panel-marketing-contact-completed.json';
import fixture from '../fixtures/panel-marketing-contact-import.json';
import preview from '../fixtures/panel-marketing-contact-preview.json';
import queued from '../fixtures/panel-marketing-contact-queued.json';
import result from '../fixtures/panel-marketing-contact-result.json';
import suppression from '../fixtures/panel-marketing-suppression-import.json';
import suppressionPreview from '../fixtures/panel-marketing-suppression-preview.json';
import suppressionResult from '../fixtures/panel-marketing-suppression-result.json';
import { withPage } from '../page-decorators.js';
import { pl } from '../../i18n/pl.js';

const meta = { title: 'Pages/PanelMarketingContactImport', id: 'panel-marketing-contact-import', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'pl', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'panel-marketing-contact-import--shadcn--desktop', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'panel-marketing-contact-import--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };
export const English: Story = { parameters: { locale: 'en' } };
export const MappingWithWarnings: Story = { parameters: { fixture: preview } };
export const Attestation: Story = { parameters: { fixture: preview }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await canvas.findAllByText(/Invalid email/);
  await userEvent.click(canvas.getByRole('checkbox', { name: pl.directory.skipInvalid }));
  await userEvent.click(canvas.getByRole('button', { name: pl.directory.next }));
} };
export const Queued: Story = { parameters: { fixture: queued } };
export const CompletedWithErrors: Story = { parameters: { fixture: result } };
export const SuppressionUpload: Story = { parameters: { fixture: suppression } };
export const SuppressionPreview: Story = { parameters: { fixture: suppressionPreview } };
export const SuppressionResult: Story = { parameters: { fixture: suppressionResult } };
export const AmbiguousDelimiter: Story = { play: async ({ canvasElement }) => {
  await userEvent.upload(await within(canvasElement).findByLabelText(pl.directory.file), new File(['address;label,extra\nanna@example.org;Anna,Example'], 'ambiguous.csv', { type: 'text/csv' }));
} };

export const Error: Story = { parameters: { fixture: error } };
export const Failed: Story = { parameters: { fixture: failed } };
export const Cancelled: Story = { parameters: { fixture: cancelled } };
export const Processing: Story = { parameters: { fixture: processing } };
export const Completed: Story = { parameters: { fixture: completed } };
