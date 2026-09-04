import { describe, expect, it } from 'vitest';

import type {
  Course,
  CourseLesson,
  Identity,
  Member,
  MemberEvent,
  Product,
} from '#core/domain/index.js';
import type {
  CourseLessonRepository,
  CourseRepository,
  MemberEventRepository,
  MemberRepository,
  ProductBatchReader,
  ProductRepository,
} from '../ports.js';

import { listMemberTimeline } from './member-events.js';

const identity = (tenantId: string | null): Identity => ({
  userId: 'owner-1',
  email: 'owner@example.test',
  name: 'Owner',
  emailVerified: true,
  tenantId,
  tenantSlug: tenantId === null ? null : 'acme',
  tenantName: tenantId === null ? null : 'Acme',
  staffRole: tenantId === null ? null : 'owner',
  memberId: null,
  image: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
  memberLanguage: null,
});

const member: Member = {
  id: 'member-1',
  tenantId: 'tenant-1',
  userId: 'user-1',
  email: 'member@example.test',
  displayName: null,
  tags: [],
  marketingConsents: {},
  externalCustomerIds: {},
  createdAt: '2026-08-01T10:00:00.000Z',
  deletedAt: null,
  bannedAt: null,
  bannedReason: null,
  bannedByUserId: null,
  dmOptOutAt: null,
};

const event: MemberEvent = {
  id: 'purchase:order-1',
  tenantId: 'tenant-1',
  memberId: member.id,
  type: 'purchase',
  payload: {
    orderId: 'order-1',
    productId: 'product-1',
    kind: 'one_time',
    status: 'paid',
    amountCents: 4900,
    currency: 'PLN',
    provider: 'stripe',
  },
  occurredAt: '2026-08-02T10:00:00.000Z',
};

const lessonEvent: MemberEvent = {
  id: 'lesson-completion:progress-1:lesson-1:2026-08-03T10:00:00.000Z',
  tenantId: 'tenant-1',
  memberId: member.id,
  type: 'lesson-completion',
  payload: {
    courseId: 'course-1',
    lessonId: 'lesson-1',
  },
  occurredAt: '2026-08-03T10:00:00.000Z',
};

const product: Product = {
  id: 'product-1',
  tenantId: 'tenant-1',
  type: 'course',
  slug: 'advanced-course',
  coverUrl: null,
  title: 'Advanced course',
  description: '',
  priceCents: 4900,
  currency: 'PLN',
  published: true,
  accessItems: [],
  legacyId: null,
  createdAt: '2026-07-01T10:00:00.000Z',
};

const course: Course = {
  id: 'course-1',
  tenantId: 'tenant-1',
  name: 'JavaScript foundations',
  description: '',
  imageUrl: null,
  moduleOrder: [],
  publiclyVisible: false,
  legacyId: null,
  createdAt: '2026-07-01T10:00:00.000Z',
};

const lesson: CourseLesson = {
  id: 'lesson-1',
  tenantId: 'tenant-1',
  name: 'Variables',
  isPreview: false,
  contents: [],
  legacyId: null,
  createdAt: '2026-07-01T10:00:00.000Z',
};

const members: MemberRepository = {
  findById: async (tenantId, memberId) =>
    tenantId === member.tenantId && memberId === member.id ? member : null,
  findByEmail: async () => null,
  listWithProductIds: async () => [],
  create: async () => undefined,
  updateEmail: async () => null,
  updateLanguage: async () => null,
  updateDisplayName: async () => null,
  updateDmOptOut: async () => null,
  setBanned: async () => null,
};

const products: ProductRepository & ProductBatchReader = {
  listByTenant: async () => [product],
  listPublishedByTenant: async () => [product],
  findById: async (_tenantId, id) => id === product.id ? product : null,
  findByIds: async (_tenantId, ids) => ids.includes(product.id) ? [product] : [],
  create: async () => 'created',
  updateAccessItems: async () => null,
  setPublished: async () => undefined,
  bumpContentVersion: async () => undefined,
};

const courses: CourseRepository = {
  list: async () => [course],
  findById: async (_tenantId, id) => id === course.id ? course : null,
  findByIds: async (_tenantId, ids) => ids.includes(course.id) ? [course] : [],
  create: async () => undefined,
  update: async () => null,
  delete: async () => false,
};

const lessons: CourseLessonRepository = {
  list: async () => [lesson],
  listPreviews: async () => [],
  findById: async (_tenantId, id) => id === lesson.id ? lesson : null,
  findByIds: async (_tenantId, ids) => ids.includes(lesson.id) ? [lesson] : [],
  create: async () => undefined,
  update: async () => null,
  delete: async () => false,
};

describe('listMemberTimeline', () => {
  it('returns the one tenant-scoped merged event stream', async () => {
    const calls: Array<[string, string]> = [];
    const memberEvents: MemberEventRepository = {
      append: async () => undefined,
      listForMember: async (tenantId, memberId) => {
        calls.push([tenantId, memberId]);
        return [event, lessonEvent];
      },
    };
    const result = await listMemberTimeline(
      { identity: identity('tenant-1') },
      { memberId: member.id },
      { members, memberEvents, products, courses, lessons },
    );

    expect(result).toEqual({
      ok: true,
      value: [
        {
          ...event,
          payload: { ...event.payload, productTitle: product.title },
        },
        {
          ...lessonEvent,
          payload: {
            ...lessonEvent.payload,
            courseTitle: course.name,
            lessonTitle: lesson.name,
          },
        },
      ],
    });
    expect(calls).toEqual([['tenant-1', 'member-1']]);
  });

  it('does not query another tenant or an unknown member', async () => {
    let queried = false;
    const memberEvents: MemberEventRepository = {
      append: async () => undefined,
      listForMember: async () => {
        queried = true;
        return [];
      },
    };
    const result = await listMemberTimeline(
      { identity: identity('tenant-2') },
      { memberId: member.id },
      { members, memberEvents, products, courses, lessons },
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(queried).toBe(false);
  });
});
