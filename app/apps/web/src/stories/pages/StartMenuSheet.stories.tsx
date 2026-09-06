import type { Meta, StoryObj } from '@storybook/react-vite';
import fixture from '../fixtures/start-menu-sheet.json';
import { withPage } from '../page-decorators.js';

const meta = { title: 'Pages/StartMenuSheet', id: 'start-menu-sheet', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'pl', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShadcnMobile: Story = { parameters: { __id: 'start-menu-sheet--shadcn--mobile', viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };
