import type { Meta, StoryObj } from '@storybook/react-vite';
import fixture from '../fixtures/member-email-timeline.json';
import { withPage } from '../page-decorators.js';

const meta = { title: 'Pages/MemberEmailTimeline', id: 'member-email-timeline', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'en', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'member-email-timeline--shadcn--desktop', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'member-email-timeline--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };
