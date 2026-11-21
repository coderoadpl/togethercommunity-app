import { useState } from 'react';
import { Box, Button } from '@mui/material';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { SectionCard } from '../components/layout/index.js';
import { ProductComplianceFields, complianceDraftFrom, type ComplianceDraft } from '../features/home/products/ProductComplianceFields.js';
import { useTranslations } from '../i18n/index.js';
import { withSurveyPreview } from './page-decorators.js';

const outsideEu = complianceDraftFrom({
  manufacturerName: 'Example Lamp Works',
  manufacturerAddress: '1 Example Road, Example City, Norway',
  manufacturerEmail: 'safety@lamps.togethercommunity.app',
  manufacturerOutsideEu: true,
  responsiblePersonName: 'Example EU Representative',
  responsiblePersonAddress: 'Example Street 1, 00-001 Warsaw, Poland',
  responsiblePersonEmail: 'eu-rep@studio.togethercommunity.app',
  modelIdentifier: 'LAMP-2',
  safetyWarnings: 'Keep away from water.',
});

const EditorPreview = ({ initial, invalid = false }: { initial: ComplianceDraft; invalid?: boolean }) => {
  const t = useTranslations();
  const [value, setValue] = useState<ComplianceDraft>(initial);
  return <Box data-testid="product-safety-editor-preview" sx={{ maxWidth: '46rem', mx: 'auto' }}>
    <SectionCard title={t.products.detailsHeading} actions={<Button variant="contained">{t.products.saveDetails}</Button>}>
      <ProductComplianceFields value={value} invalid={invalid} onChange={setValue} />
    </SectionCard>
  </Box>;
};

const meta = {
  title: 'Studio/Product safety editor',
  decorators: [withSurveyPreview],
  parameters: { locale: 'en', layout: 'fullscreen' },
  render: () => <EditorPreview initial={outsideEu} />,
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const ManufacturerOutsideEu: Story = {};
export const ManufacturerOutsideEuDark: Story = { parameters: { colorScheme: 'dark' } };
export const ManufacturerOutsideEuMobile: Story = { globals: { viewport: { value: 'mobile' } } };
export const ResponsiblePersonMissing: Story = {
  render: () => <EditorPreview initial={{ ...outsideEu, responsiblePersonAddress: '', responsiblePersonEmail: '' }} invalid />,
};
export const ResponsiblePersonMissingPolish: Story = { ...ResponsiblePersonMissing, parameters: { locale: 'pl' } };
