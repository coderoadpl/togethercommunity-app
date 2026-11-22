import { OrderVerification, OrderVerificationLookup } from '../features/home/sales/OrderVerification.js';
import { Box, Stack } from '@mui/material';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { SalesLinkEditor } from '../features/home/sales-links/SalesLinkEditor.js';
import { sampleBundleProducts, sampleSalesLink, sampleBundleOrder } from '../test/sales-link-fixtures.js';
import { withSurveyPreview } from './page-decorators.js';

const VerificationPreview = () => <Box sx={{ maxWidth: '60rem', mx: 'auto', py: { xs: 1, sm: 4 } }}><Stack spacing={3}><OrderVerificationLookup onFind={() => undefined} /><OrderVerification order={sampleBundleOrder} canIssue onIssue={() => undefined} /></Stack></Box>;
const EditorPreview = () => <SalesLinkEditor salesLink={sampleSalesLink} products={sampleBundleProducts} onSave={() => undefined} onCancel={() => undefined} />;
const meta = { title: 'SalesLinks/Bundle', decorators: [withSurveyPreview], parameters: { locale: 'en', colorScheme: 'light', layout: 'fullscreen' }, render: () => <EditorPreview />, play: async () => { await document.fonts.ready; } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const EditorLightDesktop: Story = { render: () => <EditorPreview />, parameters: { colorScheme: 'light' }, globals: { viewport: { value: 'desktop' } } };
export const EditorLightMobile: Story = { render: () => <EditorPreview />, parameters: { colorScheme: 'light' }, globals: { viewport: { value: 'mobile' } } };
export const EditorDarkDesktop: Story = { render: () => <EditorPreview />, parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'desktop' } } };
export const EditorDarkMobile: Story = { render: () => <EditorPreview />, parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'mobile' } } };
export const VerificationLightDesktop: Story = { render: () => <VerificationPreview />, parameters: { colorScheme: 'light' }, globals: { viewport: { value: 'desktop' } } };
export const VerificationLightMobile: Story = { render: () => <VerificationPreview />, parameters: { colorScheme: 'light' }, globals: { viewport: { value: 'mobile' } } };
export const VerificationDarkDesktop: Story = { render: () => <VerificationPreview />, parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'desktop' } } };
export const VerificationDarkMobile: Story = { render: () => <VerificationPreview />, parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'mobile' } } };
