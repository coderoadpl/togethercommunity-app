import { userEvent, within } from 'storybook/test';
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

const personalisedStory = (viewport: 'desktop' | 'mobile'): Story => ({
  parameters: { fixture: { ...fixture, calls: { ...fixture.calls,
    'getOrder:["order-studio-active-js"]': { ok: true, value: { ...fixture.calls['getOrder:["order-studio-active-js"]'].value, order: {
      ...fixture.calls['getOrder:["order-studio-active-js"]'].value.order,
      lines: fixture.calls['getOrder:["order-studio-active-js"]'].value.order.lines.map((line) => ({ ...line, personalization: {
        text: 'For Alexa, with love', originalText: 'For Alex, with love', label: 'Add an engraving', description: '', inputLabel: 'Engraving text',
        condition: 'I understand a personalised item is made to my order.', maxLength: 60,
        requestedAt: '2026-06-01T12:00:00.000Z', conditionAcceptedAt: '2026-06-01T12:00:00.000Z', editedAt: '2026-06-02T09:15:00.000Z', editedBy: 'staff-studio-owner',
      } })),
    } } },
  } } }, globals: { viewport: { value: viewport } },
});
export const PersonalisedDesktop: Story = personalisedStory('desktop');
export const PersonalisedMobile: Story = personalisedStory('mobile');

const deliveryStory = (state: 'to_pack' | 'label_ready' | 'shipped'): Story => {
  const recorded = fixture.calls['getOrder:["order-studio-active-js"]'].value;
  const label = { carrier: 'inpost', trackingNumber: '520000011395200025754311' };
  const shipment = state === 'to_pack' ? null : {
    shipxShipmentId: '1001', status: 'confirmed', trackingNumber: label.trackingNumber, environment: 'production',
    createAttemptedAt: null, boughtAt: '2026-06-02T09:00:00.000Z', labelFetchedAt: null,
    createdAt: '2026-06-02T09:00:00.000Z', updatedAt: '2026-06-02T09:00:00.000Z',
  };
  const shipx = { available: state !== 'shipped', reason: state === 'shipped' ? 'not_to_pack' : null, environment: 'production', service: 'inpost_locker_standard', parcelTemplate: 'medium', shipment };
  return {
    parameters: { fixture: { ...fixture, calls: { ...fixture.calls,
      'getOrder:["order-studio-active-js"]': { ok: true, value: { ...recorded, order: {
        ...recorded.order,
        memberName: 'Alex Example', memberEmail: 'buyer@example.org', productTitle: 'Printed workbook',
        lines: [{ ...recorded.order.lines[0], productId: 'product-workbook', name: 'Printed workbook', productType: 'physical' }],
        fulfilmentStatus: state === 'shipped' ? 'shipped' : 'to_pack',
        label: state === 'to_pack' ? null : label,
        shipment: state === 'shipped' ? { ...label, shippedAt: '2026-06-02T10:00:00.000Z', shippedBy: 'staff-demo', shippedByDisplayName: 'Demo Staff' } : null,
        shipping: {
          rateId: 'locker', label: 'Parcel locker', amountCents: 1499, vatRatePercent: 23, carrier: 'inpost',
          pickupPoint: { provider: 'inpost', code: 'WAW01M', name: null, address: null },
          address: { name: 'Alex Example', line1: 'Sample Street 1', line2: null, postalCode: '00-001', city: 'Warsaw', country: 'PL' }, phone: '+48500000000',
        },
      } } },
      'shipxRefresh:[{"orderId":"order-studio-active-js"}]': { ok: true, value: shipx },
      'shipxShipment:[{"orderId":"order-studio-active-js"}]': { ok: true, value: shipx },
    } } },
  };
};

export const DeliveryToPack: Story = deliveryStory('to_pack');
export const DeliveryLabelReady: Story = deliveryStory('label_ready');
export const DeliveryShipped: Story = deliveryStory('shipped');
export const CreateLabelConfirmation: Story = {
  ...deliveryStory('to_pack'),
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByTestId('order-shipx-create'));
  },
};
export const DispatchLabelConfirmation: Story = {
  ...deliveryStory('label_ready'),
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByTestId('order-ship'));
  },
};
