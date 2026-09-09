import type { Meta, StoryObj } from '@storybook/react-vite';
import fixture from '../fixtures/anon-home-branded.json';
import populatedFixture from '../fixtures/anon-home-tiles.json';
import { withPage } from '../page-decorators.js';

const meta = { title: 'Pages/AnonHomeBranded', id: 'anon-home-branded', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'en', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'anon-home-branded--shadcn--desktop', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'anon-home-branded--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };
export const DarkDesktop: Story = { parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'desktop' } } };
export const DarkMobile: Story = { parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'mobile' } } };
export const LightMobileEnglish: Story = { parameters: { colorScheme: 'light', locale: 'en' }, globals: { viewport: { value: 'mobile' } } };

const offer = populatedFixture.calls['publicOffer:[]'];
const yellowFixture = { ...populatedFixture, calls: { ...populatedFixture.calls, 'publicOffer:[]': { ...offer, value: { ...offer.value, tenant: { ...offer.value.tenant, branding: { ...offer.value.tenant.branding, accentColor: '#F5C842' } } } } } };
export const YellowLightMobile: Story = { parameters: { fixture: yellowFixture, colorScheme: 'light' }, globals: { viewport: { value: 'mobile' } } };
export const YellowDarkMobile: Story = { parameters: { fixture: yellowFixture, colorScheme: 'dark' }, globals: { viewport: { value: 'mobile' } } };
