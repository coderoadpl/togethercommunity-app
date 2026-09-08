import type { Meta, StoryObj } from '@storybook/react-vite';
import acmeFixture from '../fixtures/acme-lesson.json';
import fixture from '../fixtures/lesson.json';
import { withPage } from '../page-decorators.js';

const meta = { title: 'Pages/LessonPlayer', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'pl', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const LightDesktop: Story = { parameters: { viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const LightMobile: Story = { parameters: { viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };
export const Acme: Story = { parameters: { fixture: acmeFixture } };
