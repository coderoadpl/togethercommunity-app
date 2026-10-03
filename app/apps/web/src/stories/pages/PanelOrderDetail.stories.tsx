import type { Meta, StoryObj } from '@storybook/react-vite';
import fixture from '../fixtures/panel-order-detail.json';
import { withPage } from '../page-decorators.js';

const meta = { title: 'Pages/PanelOrderDetail', id: 'panel-order-detail', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'en', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'panel-order-detail--shadcn--desktop', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'panel-order-detail--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };

const copiesStory = (colorScheme: 'light' | 'dark', viewport: 'desktop' | 'mobile'): Story => ({
  parameters: { colorScheme, fixture: { ...fixture, calls: { ...fixture.calls,
    'listDownloadCopies:[{"orderId":"order-studio-active-js"}]': { ok: true, value: { copies: [{
      id: 'copy-demo', tenantId: 'tenant-studio', memberId: 'member-studio-active',
      orderId: 'order-studio-active-js', productId: 'product-download-workbook', assetId: 'asset-workbook',
      lineageId: 'asset-workbook', versionNumber: 2, fileName: 'workbook.pdf',
      copyIdentifier: 'copy_AAAAAAAAAAAAAAAAAAAAAAAAAA', personalised: true,
      contentHash: 'a'.repeat(64), bytes: 4096, createdAt: '1998-07-12T12:00:00.000Z',
    }] } },
  } } }, globals: { viewport: { value: viewport } },
});
export const CopiesLightDesktop: Story = copiesStory('light', 'desktop');
export const CopiesLightMobile: Story = copiesStory('light', 'mobile');
export const CopiesDarkDesktop: Story = copiesStory('dark', 'desktop');
export const CopiesDarkMobile: Story = copiesStory('dark', 'mobile');
