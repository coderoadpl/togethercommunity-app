import type { Meta, StoryObj } from '@storybook/react-vite';
import product from '../fixtures/panel-marketing-list-product-grant.json';
import consent from '../fixtures/panel-marketing-list-consent-definition.json';
import error from '../fixtures/panel-marketing-list-error.json';
import fixture from '../fixtures/panel-marketing-lists.json';
import empty from '../fixtures/panel-marketing-lists-empty.json';
import create from '../fixtures/panel-marketing-list-new.json';
import staticList from '../fixtures/panel-marketing-list-static.json';
import dynamic from '../fixtures/panel-marketing-list-dynamic.json';
import { withPage } from '../page-decorators.js';

const meta = { title: 'Pages/PanelMarketingLists', id: 'panel-marketing-lists', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'pl', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'panel-marketing-lists--shadcn--desktop', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'panel-marketing-lists--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };
export const English: Story = { parameters: { locale: 'en' } };
export const Empty: Story = { parameters: { fixture: empty } };
export const Create: Story = { parameters: { fixture: create } };
export const StaticMemberships: Story = { parameters: { fixture: staticList } };
export const DynamicRule: Story = { parameters: { fixture: dynamic } };

export const ProductGrantRule: Story = { parameters: { fixture: product } };
export const ConsentRule: Story = { parameters: { fixture: consent } };
export const Error: Story = { parameters: { fixture: error } };
