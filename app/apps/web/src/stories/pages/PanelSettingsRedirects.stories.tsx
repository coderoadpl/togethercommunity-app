import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import fixture from '../fixtures/panel-settings-redirects.json';
import { withPage } from '../page-decorators.js';

const meta = { title: 'Pages/PanelSettingsRedirects', id: 'panel-settings-redirects', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'en', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'panel-settings-redirects--shadcn--desktop', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'panel-settings-redirects--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };
export const LightDesktop1440: Story = { parameters: { colorScheme: 'light', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const LightMobile390: Story = { parameters: { colorScheme: 'light', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };
export const DarkDesktop1440: Story = { parameters: { colorScheme: 'dark', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const DarkMobile390: Story = { parameters: { colorScheme: 'dark', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };

const editStory = (colorScheme: 'light' | 'dark', viewport: 'desktop' | 'mobile'): Story => ({
  parameters: {
    colorScheme,
    viewport: { defaultViewport: viewport },
  },
  globals: { viewport: { value: viewport } },
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByTestId('redirect-edit-redirect-studio-offer'));
  },
});

export const ShadcnEditDesktop: Story = {
  ...editStory('light', 'desktop'),
  parameters: {
    ...editStory('light', 'desktop').parameters,
    __id: 'panel-settings-redirects-edit--shadcn--desktop',
  },
};
export const ShadcnEditMobile: Story = {
  ...editStory('light', 'mobile'),
  parameters: {
    ...editStory('light', 'mobile').parameters,
    __id: 'panel-settings-redirects-edit--shadcn--mobile',
  },
};

export const EditLightDesktop1440: Story = editStory('light', 'desktop');
export const EditLightMobile390: Story = editStory('light', 'mobile');
export const EditDarkDesktop1440: Story = editStory('dark', 'desktop');
export const EditDarkMobile390: Story = editStory('dark', 'mobile');
