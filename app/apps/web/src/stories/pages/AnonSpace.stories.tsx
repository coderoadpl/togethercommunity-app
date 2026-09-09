import type { Meta, StoryObj } from '@storybook/react-vite';
import fixture from '../fixtures/anon-home-tiles.json';
import { withPage } from '../page-decorators.js';

const publicEventsCall = 'publicSpaceEvents:[{"limit":5,"scope":"upcoming","spaceId":"space-studio-spolecznosc"}]';
const anonSpaceFixture = {
  ...fixture,
  route: '/community/space-studio-spolecznosc',
  calls: {
    ...fixture.calls,
    [publicEventsCall]: {
      ok: true,
      value: { events: [], nextCursor: null },
    },
  },
};

const meta = { title: 'Pages/AnonSpace', id: 'anon-space', render: () => <></>, decorators: [withPage], parameters: { fixture: anonSpaceFixture, locale: 'pl', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const ShadcnMobile: Story = {
  parameters: { __id: 'anon-space--shadcn--mobile', viewport: { defaultViewport: 'mobile' } },
  globals: { viewport: { value: 'mobile' } },
};
