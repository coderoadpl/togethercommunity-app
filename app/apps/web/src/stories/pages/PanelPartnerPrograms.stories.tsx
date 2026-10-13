import type { Meta, StoryObj } from '@storybook/react-vite';
import { partnerProgramsFixture as fixture } from '../partner-fixtures.js';
import { withPage } from '../page-decorators.js';

const meta = { title: 'Pages/PanelPartnerPrograms', id: 'panel-partner-programs', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'en', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'panel-partner-programs--shadcn--desktop', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'panel-partner-programs--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };
