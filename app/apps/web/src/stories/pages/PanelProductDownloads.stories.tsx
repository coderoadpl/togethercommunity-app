import { userEvent, within } from 'storybook/test';
import { en } from '../../i18n/en.js';
import { pl } from '../../i18n/pl.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import fixture from '../fixtures/panel-product-downloads.json';
import { withPage } from '../page-decorators.js';

const meta = { title: 'Pages/PanelProductDownloads', id: 'panel-product-downloads', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'en', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;



const visibilityStory = (visibility: 'listed' | 'unlisted', locale: 'en' | 'pl'): Story => ({
  parameters: {
    locale,
    fixture: {
      ...fixture,
      calls: {
        ...fixture.calls,
        'listProducts:[]': {
          ok: true,
          value: { products: fixture.calls['listProducts:[]'].value.products.map((product) => ({ ...product, visibility })) },
        },
      },
    },
  },
});
export const ListedEditorEn: Story = visibilityStory('listed', 'en');
export const UnlistedEditorEn: Story = visibilityStory('unlisted', 'en');
export const ListedEditorPl: Story = visibilityStory('listed', 'pl');
export const UnlistedEditorPl: Story = visibilityStory('unlisted', 'pl');

export const VersionsDarkDesktop: Story = { parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'desktop' } } };
export const VersionsDarkMobile: Story = { parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'mobile' } } };
export const VersionsPolish: Story = { parameters: { locale: 'pl' }, globals: { viewport: { value: 'mobile' } } };

const sizeNoticeFixture = {
  ...fixture,
  calls: {
    ...fixture.calls,
    'listProductDownloadAssets:["product-download-workbook"]': {
      ok: true,
      value: {
        personalisationMaxBytes: 20971520,
        assets: fixture.calls['listProductDownloadAssets:["product-download-workbook"]'].value.assets.map((asset) =>
          asset.id === 'download-asset-workbook-v2'
            ? { ...asset, sizeBytes: 26214400, personalisationSizeExceeded: true }
            : asset),
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

const copyLookupStory = (colorScheme: 'light' | 'dark', viewport: 'desktop' | 'mobile', locale: 'en' | 'pl'): Story => ({
  parameters: { colorScheme, locale },
  globals: { viewport: { value: viewport } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const t = locale === 'pl' ? pl : en;
    await userEvent.type(await canvas.findByRole('textbox', { name: t.downloadCopies.identifier }), 'copy_AAAAAAAAAAAAAAAAAAAAAAAAAA');
    await userEvent.keyboard('{Enter}');
    await canvas.findByRole('link', { name: 'member-studio-active' });
    await userEvent.click(canvas.getByRole('heading', { name: t.downloadCopies.title }));
  },
});

export const ShadcnDesktop: Story = {
  ...copyLookupStory('light', 'desktop', 'en'),
  parameters: { ...copyLookupStory('light', 'desktop', 'en').parameters, __id: 'panel-product-downloads--shadcn--desktop' },
};
export const ShadcnMobile: Story = {
  ...copyLookupStory('light', 'mobile', 'en'),
  parameters: { ...copyLookupStory('light', 'mobile', 'en').parameters, __id: 'panel-product-downloads--shadcn--mobile' },
};
export const CopyLookupLightDesktop: Story = copyLookupStory('light', 'desktop', 'en');
export const CopyLookupLightMobile: Story = copyLookupStory('light', 'mobile', 'pl');
export const CopyLookupDarkDesktop: Story = copyLookupStory('dark', 'desktop', 'en');
export const CopyLookupDarkMobile: Story = copyLookupStory('dark', 'mobile', 'pl');
