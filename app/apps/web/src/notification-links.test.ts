import { describe, expect, it } from 'vitest';

import type { Notification } from '#core/domain/index.js';

import { en } from './i18n/en.js';
import { notificationSnippet, notificationSnippetParts, notificationTarget, notificationTitle } from './notification-links.js';

const notification = (input: {
  kind: Notification['kind'];
  contextKind: 'lesson' | 'space' | 'dm';
  contextId: string;
  courseId: string | null;
  eventId?: string | null;
  lessonName?: string;
}): Notification => ({
  id: 'n1',
  tenantId: 't1',
  recipientUserId: 'u1',
  kind: input.kind,
  payload: {
    rootPostId: 'root-1',
    postId: 'reply-1',
    contextKind: input.contextKind,
    contextId: input.contextId,
    courseId: input.courseId,
    eventId: input.eventId ?? null,
    domain: null,
    lessonName: input.lessonName ?? 'Hamaki w kamperze',
    authorDisplay: 'Ola',
    authorAvatarUrl: null,
    snippet: 'Replying now',
  },
  sourceKey: null,
  readAt: null,
  createdAt: '2026-08-15T08:00:00.000Z',
});

describe('notificationTarget', () => {
  it('routes a space post to the thread page of its root post', () => {
    expect(
      notificationTarget(
        notification({ kind: 'space-post', contextKind: 'space', contextId: 's1', courseId: null }),
      ),
    ).toEqual({ kind: 'space-thread', spaceId: 's1', postId: 'root-1' });
  });

  it('routes a lesson question to its lesson with the thread root', () => {
    expect(
      notificationTarget(
        notification({
          kind: 'lesson-question',
          contextKind: 'lesson',
          contextId: 'l1',
          courseId: 'c1',
        }),
      ),
    ).toEqual({ kind: 'lesson-thread', courseId: 'c1', lessonId: 'l1', rootPostId: 'root-1' });
  });

  it('routes a lesson thread reply to its lesson with the thread root', () => {
    expect(
      notificationTarget(
        notification({
          kind: 'thread-reply',
          contextKind: 'lesson',
          contextId: 'l1',
          courseId: 'c1',
        }),
      ),
    ).toEqual({ kind: 'lesson-thread', courseId: 'c1', lessonId: 'l1', rootPostId: 'root-1' });
  });

  it('routes a direct message to its conversation', () => {
    expect(
      notificationTarget(
        notification({ kind: 'dm-message', contextKind: 'dm', contextId: 'c1', courseId: null }),
      ),
    ).toEqual({ kind: 'dm-conversation', conversationId: 'c1' });
  });

  it('routes a space event to its event page', () => {
    expect(
      notificationTarget(
        notification({
          kind: 'space-event',
          contextKind: 'space',
          contextId: 's1',
          courseId: null,
          eventId: 'e1',
        }),
      ),
    ).toEqual({ kind: 'space-event', spaceId: 's1', eventId: 'e1' });
  });

  it('leaves a space event without an event id unroutable', () => {
    expect(
      notificationTarget(
        notification({
          kind: 'space-event',
          contextKind: 'space',
          contextId: 's1',
          courseId: null,
        }),
      ),
    ).toEqual({ kind: 'none' });
  });

  it('leaves a legacy lesson notification without a course unroutable', () => {
    expect(
      notificationTarget(
        notification({
          kind: 'thread-reply',
          contextKind: 'lesson',
          contextId: 'l1',
          courseId: null,
        }),
      ),
    ).toEqual({ kind: 'none' });
  });
});

describe('notificationTitle', () => {
  it('names the space for a space post', () => {
    expect(
      notificationTitle(
        en,
        notification({
          kind: 'space-post',
          contextKind: 'space',
          contextId: 's1',
          courseId: null,
          lessonName: 'General',
        }),
      ),
    ).toBe(en.notifications.spacePost({ author: 'Ola', space: 'General' }));
  });

  it('names the sender for a direct message', () => {
    expect(
      notificationTitle(
        en,
        notification({
          kind: 'dm-message',
          contextKind: 'dm',
          contextId: 'c1',
          courseId: null,
          lessonName: 'Ola',
        }),
      ),
    ).toBe(en.notifications.dmMessage({ author: 'Ola' }));
  });

  it('names the space for a new event', () => {
    expect(
      notificationTitle(
        en,
        notification({
          kind: 'space-event',
          contextKind: 'space',
          contextId: 's1',
          courseId: null,
          eventId: 'e1',
          lessonName: 'General',
        }),
      ),
    ).toBe(en.notifications.spaceEvent({ space: 'General' }));
  });

  it('names the lesson for a question and for a reply', () => {
    expect(
      notificationTitle(
        en,
        notification({
          kind: 'lesson-question',
          contextKind: 'lesson',
          contextId: 'l1',
          courseId: 'c1',
        }),
      ),
    ).toBe(en.notifications.lessonQuestion({ author: 'Ola', lesson: 'Hamaki w kamperze' }));
    expect(
      notificationTitle(
        en,
        notification({
          kind: 'thread-reply',
          contextKind: 'lesson',
          contextId: 'l1',
          courseId: 'c1',
        }),
      ),
    ).toBe(en.notifications.threadReply({ author: 'Ola', lesson: 'Hamaki w kamperze' }));
  });
});

describe('change proposal notifications', () => {
  const proposal = (snippet: string): Notification => ({
    id: 'n-proposal',
    tenantId: 't1',
    recipientUserId: 'owner',
    kind: 'change-proposal',
    payload: {
      rootPostId: null,
      postId: null,
      contextKind: 'tenant',
      contextId: snippet === '' ? null : 'group-1',
      courseId: null,
      eventId: null,
      domain: null,
      lessonName: '',
      authorDisplay: 'Catalogue agent',
      authorAvatarUrl: null,
      snippet,
    },
    sourceKey: 'change-proposal:key-1',
    readAt: null,
    createdAt: '2026-11-20T08:00:00.000Z',
  });

  it('opens the proposals page for a single proposal and for a group', () => {
    expect(notificationTarget(proposal(''))).toEqual({ kind: 'change-proposals' });
    expect(notificationTarget(proposal('Launch the field guide'))).toEqual({ kind: 'change-proposals' });
  });

  it('names the key in the title and attributes the group title in the text', () => {
    expect(notificationTitle(en, proposal(''))).toBe(en.notifications.changeProposal({ key: 'Catalogue agent' }));
    expect(notificationSnippet(en, proposal(''))).toBe('');
    expect(notificationSnippet(en, proposal('<b>Launch</b>'))).toBe(en.notifications.changeProposalGroup({ title: '<b>Launch</b>' }));
  });

  it('splits the group title out of its sentence so the bell can isolate it', () => {
    const title = 'Spring\u201D \u202Elaunch';
    const parts = notificationSnippetParts(en, proposal(title));
    expect(parts.isolated).toBe(title);
    expect(`${parts.before}${parts.isolated}${parts.after}`).toBe(en.notifications.changeProposalGroup({ title }));
    expect(notificationSnippetParts(en, proposal(''))).toEqual({ before: '', isolated: '', after: '' });
  });

  it('reads the typed payload of a new notification, whose community fields stay empty', () => {
    const typed = (groupTitle: string | null): Notification => {
      const base = proposal('');
      return {
        ...base,
        payload: {
          ...base.payload,
          authorDisplay: null,
          changeProposal: { keyName: 'Catalogue agent', groupId: groupTitle === null ? null : 'group-1', groupTitle },
        },
      };
    };
    expect(notificationTitle(en, typed(null))).toBe(en.notifications.changeProposal({ key: 'Catalogue agent' }));
    expect(notificationSnippet(en, typed(null))).toBe('');
    expect(notificationSnippet(en, typed('Launch'))).toBe(en.notifications.changeProposalGroup({ title: 'Launch' }));
    expect(notificationSnippetParts(en, typed('Launch')).isolated).toBe('Launch');
  });
});
