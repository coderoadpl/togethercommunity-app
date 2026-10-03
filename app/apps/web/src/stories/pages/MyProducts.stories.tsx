import type { Meta, StoryObj } from '@storybook/react-vite';
import fixture from '../fixtures/my-products.json';
import { withPage } from '../page-decorators.js';

const meta = { title: 'Pages/MyProducts', id: 'my-products', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'en', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'my-products--shadcn--desktop', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'my-products--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };
export const ShadcnMobile375: Story = { parameters: { __id: 'my-products--shadcn--mobile-375', viewport: { defaultViewport: 'mobile-375' } }, globals: { viewport: { value: 'mobile-375' } } };

export const ExpiredAccess: Story = {
  parameters: {
    fixture: {
      ...fixture,
      calls: {
        ...fixture.calls,
        'myProducts:[]': {
          ok: true,
          value: {
            products: fixture.calls['myProducts:[]'].value.products.map((product, index) => ({
              ...product,
              grantStatus: 'expired',
              grantExpiresAt: '2026-06-30T12:00:00.000Z',
              subscription: null,
              downloads: [],
              purchasable: index === 0,
            })),
          },
        },
      },
    },
  },
};

export const ExpiredAccessPolish: Story = {
  ...ExpiredAccess,
  parameters: { ...ExpiredAccess.parameters, locale: 'pl' },
};

export const VersionsDarkDesktop: Story = { parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'desktop' } } };
export const VersionsDarkMobile: Story = { parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'mobile' } } };
export const VersionsPolish: Story = { parameters: { locale: 'pl' }, globals: { viewport: { value: 'mobile' } } };

const sizeNoticeFixture = {
  ...fixture,
  calls: {
    ...fixture.calls,
    'myProducts:[]': {
      ok: true,
      value: {
        products: fixture.calls['myProducts:[]'].value.products.map((product) => ({
          ...product,
          downloads: product.downloads.map((download) =>
            download.id === 'download-asset-workbook-v2'
              ? { ...download, sizeBytes: 26214400, personalisationSizeExceeded: true }
              : download),
        })),
      },
    },
  },
};

const sizeNoticeStory = (colorScheme: 'light' | 'dark', viewport: 'desktop' | 'mobile'): Story => ({
  parameters: { fixture: sizeNoticeFixture, colorScheme, viewport: { defaultViewport: viewport } },
  globals: { viewport: { value: viewport } },
});

export const SizeNoticeLightDesktop1440: Story = sizeNoticeStory('light', 'desktop');
export const SizeNoticeLightMobile390: Story = sizeNoticeStory('light', 'mobile');
export const SizeNoticeDarkDesktop1440: Story = sizeNoticeStory('dark', 'desktop');
export const SizeNoticeDarkMobile390: Story = sizeNoticeStory('dark', 'mobile');
