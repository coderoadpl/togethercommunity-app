import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';

import {
  createMemberEventSchema,
  defineMemberEventRegistry,
  memberEventRegistry,
  memberEventSchema,
  type MemberEvent,
} from './member-event.js';

const baseEvent = {
  id: 'event-1',
  tenantId: 'tenant-1',
  memberId: 'member-1',
  occurredAt: '2026-08-03T12:00:00.000Z',
};

describe('member event registry', () => {
  it('derives its discriminated payload union from the registry', () => {
    expectTypeOf<MemberEvent>().not.toBeAny();
    expectTypeOf<Extract<MemberEvent, { type: 'revoke' }>['payload']>().toEqualTypeOf<{
      grantId: string;
      productId: string;
      expiresAt: string;
    }>();
  });

  it('validates each event payload through its registry entry', () => {
    expect(memberEventSchema.parse({
      ...baseEvent,
      type: 'lesson-completion',
      payload: { courseId: 'course-1', lessonId: 'lesson-1' },
    })).toMatchObject({ type: 'lesson-completion' });
    expect(memberEventSchema.safeParse({
      ...baseEvent,
      type: 'lesson-completion',
      payload: { courseId: 'course-1' },
    }).success).toBe(false);
    expect(memberEventSchema.safeParse({
      ...baseEvent,
      type: 'community-post',
      payload: { postId: 'post-1' },
    }).success).toBe(false);
  });

  it('adds a type by extending only the registry-backed schema', () => {
    const extended = createMemberEventSchema(defineMemberEventRegistry({
      ...memberEventRegistry,
      'community-post': z.object({ postId: z.string().min(1) }).strict(),
    }));

    expect(extended.parse({
      ...baseEvent,
      type: 'community-post',
      payload: { postId: 'post-1' },
    })).toMatchObject({
      type: 'community-post',
      payload: { postId: 'post-1' },
    });
  });
});
