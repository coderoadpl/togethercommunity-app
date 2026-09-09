import { userEvent, within } from 'storybook/test';
import type { Meta, StoryObj } from '@storybook/react-vite';
import fixture from '../fixtures/space-feed.json';
import { withPage } from '../page-decorators.js';

const meta = { title: 'Pages/SpaceFeed', render: () => <></>, decorators: [withPage], parameters: { fixture, locale: 'en', layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const LightDesktop: Story = { parameters: { viewport: { defaultViewport: 'desktop' } }, globals: { viewport: { value: 'desktop' } } };
export const LightMobile: Story = { parameters: { viewport: { defaultViewport: 'mobile' } }, globals: { viewport: { value: 'mobile' } } };

const feedKey = 'spaceFeed:[{"spaceId":"space-studio-community"}]';
const eventsKey = 'listSpaceEvents:[{"limit":5,"scope":"past","spaceId":"space-studio-community"}]';
const feed = fixture.calls[feedKey].value.feed;
const me = fixture.calls['me:[]'];
const staffFixture = {
  ...fixture,
  calls: { ...fixture.calls, 'me:[]': { ...me, value: { ...me.value, tenant: { ...me.value.tenant, staffRole: 'admin' } } } },
};
const ownFixture = {
  ...fixture,
  calls: { ...fixture.calls, [feedKey]: { ok: true, value: { feed: { ...feed, items: feed.items.map((item) => ({ ...item, isOwn: true })) } } } },
};
const postContentFixture = {
  ...fixture,
  calls: {
    ...fixture.calls,
    [feedKey]: {
      ok: true,
      value: {
        feed: {
          ...feed,
          items: [
            {
              ...feed.items[0],
              body: 'Read https://javascript.info and share your favorite learning resource.',
              bodyFormat: 'plain',
              bodyHtml: 'Read <a href="https://javascript.info/" target="_blank" rel="noopener noreferrer nofollow ugc">https://javascript.info</a> and share your favorite learning resource.',
            },
            {
              ...feed.items[1],
              body: '**Welcome to the community.**\n\n- Introduce yourself\n- Share what you are learning',
              bodyFormat: 'markdown',
              bodyHtml: '<p><strong>Welcome to the community.</strong></p>\n<ul>\n<li>Introduce yourself</li><li>Share what you are learning</li></ul>\n',
            },
          ],
        },
      },
    },
  },
};
const tombstoneFixture = {
  ...staffFixture,
  calls: { ...staffFixture.calls, [feedKey]: { ok: true, value: { feed: { ...feed, items: feed.items.map((item, index) => ({
    ...item, body: 'Deleted post', deletedAt: '2026-07-01T12:00:00.000Z', deletedBy: index === 0 ? 'author' : 'moderator', replyCount: index === 0 ? 2 : 0, reactions: [],
  })) } } } },
};

export const EmptyEventsMember: Story = {};
export const EmptyEventsStaff: Story = { parameters: { fixture: staffFixture } };
export const DeletedThreads: Story = { parameters: { fixture: tombstoneFixture } };
export const DeletedThreadsEnglish: Story = { parameters: { fixture: tombstoneFixture, locale: 'en' } };
export const PostContentEnglish: Story = { parameters: { fixture: postContentFixture, locale: 'en' } };
export const PostContentPolish: Story = { parameters: { fixture: postContentFixture, locale: 'pl' } };
export const OwnPostMenu: Story = {
  parameters: { fixture: ownFixture },
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByTestId('post-menu-post-community-resources'));
  },
};
export const StaffPostMenu: Story = { ...OwnPostMenu, parameters: { fixture: staffFixture } };
export const PastEventsOnly: Story = {
  parameters: { fixture: { ...fixture, calls: { ...fixture.calls, [eventsKey]: { ok: true, value: { nextCursor: null, events: [{
    id: 'event-past', tenantId: 'tenant-studio', spaceId: 'space-studio-community', title: 'Community workshop', description: null,
    startsAt: '2026-06-20T16:00:00.000Z', endsAt: '2026-06-20T17:00:00.000Z', location: null, url: null, liveEmbedUrl: null, replayUrl: null,
    discussionRootPostId: 'event-thread', createdAt: '2026-06-01T12:00:00.000Z', updatedAt: null, goingCount: 4, notGoingCount: 0, viewerRsvp: null, liveNow: false,
  }] } } } } },
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByTestId('space-events-scope-past'));
  },
};
