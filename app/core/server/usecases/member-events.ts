import {
  err,
  notFound,
  ok,
  validation,
  type AppError,
  type MemberEvent,
  type MemberTimelineEvent,
  type Result,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type {
  CourseLessonRepository,
  CourseRepository,
  MemberEventRepository,
  MemberRepository,
  ProductBatchReader,
} from '../ports.js';

interface MemberTimelineDeps {
  members: MemberRepository;
  memberEvents: MemberEventRepository;
  products: ProductBatchReader;
  courses: CourseRepository;
  lessons: CourseLessonRepository;
}

const productIdFor = (event: MemberEvent): string | null => {
  switch (event.type) {
    case 'purchase':
    case 'subscription-change':
    case 'grant':
    case 'revoke':
      return event.payload.productId;
    case 'lesson-completion':
    case 'email-sent':
    case 'banned':
    case 'unbanned':
      return null;
  }
};

export const listMemberTimeline = async (
  ctx: Ctx,
  input: { memberId: string },
  deps: MemberTimelineDeps,
): Promise<Result<MemberTimelineEvent[], AppError>> => {
  const tenantId = authorizeTenant(ctx, 'member:timeline:read');
  if (!tenantId.ok) return tenantId;
  if (input.memberId.trim().length === 0) return err(validation('memberId is required'));
  const member = await deps.members.findById(tenantId.value, input.memberId);
  if (member === null) return err(notFound('Member was not found'));

  const events = await deps.memberEvents.listForMember(tenantId.value, member.id);
  const productIds = events.flatMap((event) => {
    const productId = productIdFor(event);
    return productId === null ? [] : [productId];
  });
  const courseIds = events.flatMap((event) =>
    event.type === 'lesson-completion' ? [event.payload.courseId] : [],
  );
  const lessonIds = events.flatMap((event) =>
    event.type === 'lesson-completion' ? [event.payload.lessonId] : [],
  );
  const [products, courses, lessons] = await Promise.all([
    deps.products.findByIds(tenantId.value, [...new Set(productIds)]),
    deps.courses.findByIds(tenantId.value, [...new Set(courseIds)]),
    deps.lessons.findByIds(tenantId.value, [...new Set(lessonIds)]),
  ]);
  const productTitles = new Map(products.map((product) => [product.id, product.title]));
  const courseTitles = new Map(courses.map((course) => [course.id, course.name]));
  const lessonTitles = new Map(lessons.map((lesson) => [lesson.id, lesson.name]));

  return ok(events.map((event): MemberTimelineEvent => {
    switch (event.type) {
      case 'purchase':
        return {
          ...event,
          payload: {
            ...event.payload,
            productTitle: productTitles.get(event.payload.productId) ?? null,
          },
        };
      case 'subscription-change':
        return {
          ...event,
          payload: {
            ...event.payload,
            productTitle: productTitles.get(event.payload.productId) ?? null,
          },
        };
      case 'grant':
        return {
          ...event,
          payload: {
            ...event.payload,
            productTitle: productTitles.get(event.payload.productId) ?? null,
          },
        };
      case 'revoke':
        return {
          ...event,
          payload: {
            ...event.payload,
            productTitle: productTitles.get(event.payload.productId) ?? null,
          },
        };
      case 'lesson-completion':
        return {
          ...event,
          payload: {
            ...event.payload,
            courseTitle: courseTitles.get(event.payload.courseId) ?? null,
            lessonTitle: lessonTitles.get(event.payload.lessonId) ?? null,
          },
        };
      case 'email-sent':
      case 'banned':
      case 'unbanned':
        return event;
    }
  }));
};
