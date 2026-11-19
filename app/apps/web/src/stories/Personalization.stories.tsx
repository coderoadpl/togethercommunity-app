import { useState } from 'react';
import { Box, Button, Stack } from '@mui/material';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { OrderLinePersonalization } from '#core/domain/index.js';
import { SectionCard } from '../components/layout/index.js';
import { PersonalizationField, personalizationState, type PersonalizableLine, type PersonalizationEntry } from '../features/checkout/PersonalizationField.js';
import { ProductPersonalizationFields, personalizationDraftFrom, type PersonalizationDraft } from '../features/home/products/ProductPersonalizationFields.js';
import { OrderPersonalization } from '../features/home/sales/OrderPersonalization.js';
import { useTranslations } from '../i18n/index.js';
import { withSurveyPreview } from './page-decorators.js';

const condition = 'I understand a personalised item is made to my order.';
const engraving = { label: 'Add an engraving', description: 'We engrave the text by hand on the base of the stand.', inputLabel: 'Engraving text', maxLength: 60, condition: null };
const offerLines = (withCondition: boolean): PersonalizableLine[] => [
  { productId: 'stand', name: 'Printed stand', personalization: { ...engraving, condition: withCondition ? condition : null } },
];

const CheckoutPreview = ({ entry, withCondition = false }: { entry?: PersonalizationEntry; withCondition?: boolean }) => {
  const t = useTranslations();
  const [entries, setEntries] = useState<Record<string, PersonalizationEntry>>(entry === undefined ? {} : { stand: entry });
  const state = personalizationState(offerLines(withCondition), entries, (productId, patch) => setEntries((current) => ({
    ...current,
    [productId]: { ...(current[productId] ?? { ticked: false, text: '', conditionAccepted: false }), ...patch },
  })));
  return <Box data-testid="personalization-checkout-preview" sx={{ maxWidth: '40rem', mx: 'auto', py: { xs: 1, sm: 4 } }}>
    <Stack useFlexGap spacing="1rem">
      <PersonalizationField state={state} />
      <Button variant="contained" fullWidth disabled={state.blocked}>{t.checkout.payIdle({ price: 'PLN 49.00' })}</Button>
    </Stack>
  </Box>;
};

const EditorPreview = () => {
  const t = useTranslations();
  const [value, setValue] = useState<PersonalizationDraft>(personalizationDraftFrom({ ...engraving, condition }));
  return <Box data-testid="personalization-editor-preview" sx={{ maxWidth: '46rem', mx: 'auto' }}>
    <SectionCard title={t.products.detailsHeading} actions={<Button variant="contained">{t.products.saveDetails}</Button>}>
      <ProductPersonalizationFields value={value} invalid={false} onChange={setValue} />
    </SectionCard>
  </Box>;
};

const orderLine: OrderLinePersonalization = {
  text: 'For Alex, with love', label: engraving.label, description: engraving.description, inputLabel: engraving.inputLabel,
  condition, maxLength: 60, requestedAt: '2026-11-05T10:00:00.000Z', conditionAcceptedAt: '2026-11-05T10:00:00.000Z',
};

const OrderPreview = ({ corrected = false }: { corrected?: boolean }) => (
  <Box data-testid="personalization-order-preview" sx={{ maxWidth: '46rem', mx: 'auto', py: { xs: 1, sm: 4 } }}>
    <OrderPersonalization
      personalization={corrected ? { ...orderLine, text: 'For Alexa, with love', originalText: orderLine.text, editedAt: '2026-11-06T09:15:00.000Z', editedBy: 'staff-studio-owner' } : orderLine}
      testId="order-personalization-stand"
      canCorrect
      pending={false}
      error={null}
      onCorrect={(_text, done) => done()}
    />
  </Box>
);

const meta = { title: 'Checkout/Personalisation', decorators: [withSurveyPreview], parameters: { locale: 'en', layout: 'fullscreen' }, render: () => <CheckoutPreview /> } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Unticked: Story = {};
export const Ticked: Story = { render: () => <CheckoutPreview entry={{ ticked: true, text: 'For Alex, with love', conditionAccepted: false }} /> };
export const ErrorMissingText: Story = { render: () => <CheckoutPreview entry={{ ticked: true, text: '', conditionAccepted: false }} /> };
export const WithCondition: Story = { render: () => <CheckoutPreview withCondition entry={{ ticked: true, text: 'For Alex, with love', conditionAccepted: false }} /> };
export const WithConditionMobile: Story = { render: () => <CheckoutPreview withCondition entry={{ ticked: true, text: 'For Alex, with love', conditionAccepted: true }} />, globals: { viewport: { value: 'mobile' } } };
export const WithConditionPolish: Story = { render: () => <CheckoutPreview withCondition entry={{ ticked: true, text: '', conditionAccepted: false }} />, parameters: { locale: 'pl' } };
export const StudioEditor: Story = { render: () => <EditorPreview /> };
export const StudioOrder: Story = { render: () => <OrderPreview /> };
export const StudioOrderCorrected: Story = { render: () => <OrderPreview corrected /> };
