import type { Meta, StoryObj } from '@storybook/react-vite';
import fixture from '../fixtures/panel-lesson-attachments.json';
import { withPage } from '../page-decorators.js';

const meta = { title: 'Pages/PanelLessonAttachments', id: 'panel-lesson-attachments', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'en', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnDesktop: Story = { parameters: { __id: 'panel-lesson-attachments--shadcn--desktop', viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const ShadcnMobile: Story = { parameters: { __id: 'panel-lesson-attachments--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };
