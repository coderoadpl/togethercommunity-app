import type { Meta, StoryObj } from '@storybook/react-vite';
import recorded from '../fixtures/panel-settings-security.json';
import { withPage } from '../page-decorators.js';

const settings = recorded.calls['getTenantSettings:[]'];
const fixture = { ...recorded, route: '/panel/settings#brand', calls: { ...recorded.calls, 'getTenantSettings:[]': { ...settings, value: { ...settings.value, settings: { ...settings.value.settings, accentColor: '#F5C842' } } } } };
const meta = { title: 'Pages/PanelBranding', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'pl', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const LightDesktop: Story = { parameters: { colorScheme: 'light' }, globals: { viewport: { value: 'desktop' } } };
export const LightMobile: Story = { parameters: { colorScheme: 'light' }, globals: { viewport: { value: 'mobile' } } };
export const DarkMobile: Story = { parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'mobile' } } };
export const LightMobileEnglish: Story = { parameters: { colorScheme: 'light', locale: 'en' }, globals: { viewport: { value: 'mobile' } } };
