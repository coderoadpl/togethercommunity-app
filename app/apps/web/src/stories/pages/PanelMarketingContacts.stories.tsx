import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import error from '../fixtures/panel-marketing-contact-error.json';
import fixture from '../fixtures/panel-marketing-contacts.json';
import empty from '../fixtures/panel-marketing-contacts-empty.json';
import detail from '../fixtures/panel-marketing-contact-detail.json';
import { withPage } from '../page-decorators.js';
import { pl } from '../../i18n/pl.js';

const meta = { title: 'Pages/PanelMarketingContacts', id: 'panel-marketing-contacts', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'pl', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'panel-marketing-contacts--shadcn--desktop', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'panel-marketing-contacts--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };
export const English: Story = { parameters: { locale: 'en' } };
export const Empty: Story = { parameters: { fixture: empty } };
export const Detail: Story = { parameters: { fixture: detail } };
export const Loading: Story = { parameters: { fixture: { ...fixture, pending: [{ call: 'listMarketingContacts:[{"archived":false,"limit":50}]', queryKeys: [['marketing', 'directory', 'tenant-studio', 'contacts', { limit: 50, archived: false }]] }] } } };
export const ConsentAndSuppression: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole('combobox', { name: pl.directory.consentDefinition }));
  await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole('option', { name: 'directory-news' }));
} };

export const Error: Story = { parameters: { fixture: error } };
