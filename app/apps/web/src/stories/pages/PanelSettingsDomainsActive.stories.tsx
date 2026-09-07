import type { Meta, StoryObj } from '@storybook/react-vite';
import activeFixture from '../fixtures/panel-settings-domains-verified.json';
import fixture from '../fixtures/panel-settings-domains-active.json';
import { withPage } from '../page-decorators.js';

const meta = { title: 'Pages/PanelSettingsDomainsActive', id: 'panel-settings-domains-active', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'pl', layout: 'fullscreen', docs: { description: { component: 'The inherited active-named goldens captured cached pending DNS records. Recorded Pending stories preserve those images; Active stories show the verified routing response.' } } } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { name: 'Recorded pending desktop', parameters: { __id: 'panel-settings-domains-active--shadcn--desktop', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { name: 'Recorded pending mobile', parameters: { __id: 'panel-settings-domains-active--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };

export const ActiveDesktop: Story = {
  parameters: { fixture: activeFixture, viewport: { defaultViewport: 'desktop' } },
  globals: { viewport: { value: 'desktop' } },
};
export const ActiveMobile: Story = {
  parameters: { fixture: activeFixture, viewport: { defaultViewport: 'mobile' } },
  globals: { viewport: { value: 'mobile' } },
};
