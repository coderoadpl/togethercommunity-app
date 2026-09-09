import type { Meta, StoryObj } from '@storybook/react-vite';
import fixture from '../fixtures/panel-product-downloads.json';
import { withPage } from '../page-decorators.js';

const meta = { title: 'Pages/PanelProductDownloads', id: 'panel-product-downloads', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'en', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'panel-product-downloads--shadcn--desktop', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'panel-product-downloads--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };


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
