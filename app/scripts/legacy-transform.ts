import { z } from 'zod';

import {
  isPayloadLegacyCredential,
  toLegacyPasswordHash,
} from '#adapters/auth/legacy-password.js';
import {
  migrateLegacyAccessItem,
  type LegacyAccessItem,
} from '#adapters/db/access-items-migration.js';
import type { AccessItem, Chapter, LessonBlock } from '#core/domain/index.js';

export interface Anomaly {
  kind: string;
  subject: string;
  detail: string;
}

interface LegacyModuleIdentity {
  id: string;
  title: string;
}

interface LegacyLessonIdentity {
  id: string;
  title: string;
}

export const collectOrphanContentAnomalies = (args: {
  modules: LegacyModuleIdentity[];
  lessons: LegacyLessonIdentity[];
  courseIdsByModuleId: ReadonlyMap<string, ReadonlySet<string>>;
  moduleIdsByLessonId: ReadonlyMap<string, ReadonlySet<string>>;
  mappedCourseIds: ReadonlySet<string>;
}): Anomaly[] => {
  const moduleHasTenant = (moduleId: string): boolean =>
    [...(args.courseIdsByModuleId.get(moduleId) ?? [])].some((courseId) =>
      args.mappedCourseIds.has(courseId),
    );
  const anomalies: Anomaly[] = [];
  for (const module of args.modules) {
    if (!moduleHasTenant(module.id)) {
      anomalies.push({
        kind: 'module-without-tenant',
        subject: `course-modules/${module.id}`,
        detail: `module "${module.title}" belongs to no mapped course and was not exported`,
      });
    }
  }
  for (const lesson of args.lessons) {
    const hasTenant = [...(args.moduleIdsByLessonId.get(lesson.id) ?? [])].some(moduleHasTenant);
    if (!hasTenant) {
      anomalies.push({
        kind: 'lesson-without-tenant',
        subject: `course-lessons/${lesson.id}`,
        detail: `lesson "${lesson.title}" is attached to no module belonging to a mapped course and was not exported`,
      });
    }
  }
  return anomalies;
};

const objectIdString = z.string().min(1);

export const legacyAccessItemSchema = z.object({
  id: z.string().nullish(),
  courses: z.array(objectIdString).default([]),
  courseLevelAccess: z.boolean().nullish(),
  courseModules: z.array(objectIdString).default([]),
  courseModuleLevelAccess: z.boolean().nullish(),
  courseLessons: z.array(objectIdString).default([]),
});

export type RawLegacyAccessItem = z.infer<typeof legacyAccessItemSchema>;

export interface AccessItemLookups {
  courseIdsByModuleId: ReadonlyMap<string, ReadonlySet<string>>;
  moduleIdsByLessonId: ReadonlyMap<string, ReadonlySet<string>>;
}

const partitionByCourse = (
  ids: string[],
  courseIds: string[],
  courseIdsOf: (id: string) => ReadonlySet<string>,
): { byCourse: Map<string, string[]>; unassigned: string[] } => {
  const byCourse = new Map<string, string[]>();
  const unassigned: string[] = [];
  for (const id of ids) {
    const memberCourseIds = courseIdsOf(id);
    const owner = courseIds.find((courseId) => memberCourseIds.has(courseId));
    if (owner === undefined) {
      unassigned.push(id);
      continue;
    }
    const bucket = byCourse.get(owner) ?? [];
    bucket.push(id);
    byCourse.set(owner, bucket);
  }
  return { byCourse, unassigned };
};

const lessonCourseIds = (lessonId: string, lookups: AccessItemLookups): ReadonlySet<string> => {
  const courseIds = new Set<string>();
  for (const moduleId of lookups.moduleIdsByLessonId.get(lessonId) ?? []) {
    for (const courseId of lookups.courseIdsByModuleId.get(moduleId) ?? []) {
      courseIds.add(courseId);
    }
  }
  return courseIds;
};

export const transformAccessItems = (
  accessId: string,
  rawItems: RawLegacyAccessItem[],
  lookups: AccessItemLookups,
): { items: AccessItem[]; anomalies: Anomaly[] } => {
  const items: AccessItem[] = [];
  const anomalies: Anomaly[] = [];
  const subject = `accesses/${accessId}`;
  const pushMigrated = (legacy: LegacyAccessItem, itemLabel: string): void => {
    const migrated = migrateLegacyAccessItem(legacy);
    if (migrated === null) {
      anomalies.push({
        kind: 'degenerate-access-item',
        subject,
        detail: `item ${itemLabel} grants nothing and was dropped`,
      });
      return;
    }
    items.push(migrated);
  };

  rawItems.forEach((item, index) => {
    const itemLabel = item.id ?? `#${String(index)}`;
    if (item.courses.length === 0) {
      anomalies.push({
        kind: 'degenerate-access-item',
        subject,
        detail: `item ${itemLabel} references no courses and was dropped`,
      });
      return;
    }
    if (item.courseLevelAccess === true) {
      for (const courseId of item.courses) {
        pushMigrated(
          { courseId, courseLevelAccess: true, moduleIds: [], lessonIds: [] },
          itemLabel,
        );
      }
      return;
    }
    // Legacy runtime grants modules only when courseModuleLevelAccess is set;
    // otherwise courseModules merely scope the lesson picker (see
    // createServiceEnrollment.ts lesson-access check in the legacy server).
    if (item.courseModuleLevelAccess === true) {
      if (item.courseModules.length === 0) {
        anomalies.push({
          kind: 'degenerate-access-item',
          subject,
          detail: `item ${itemLabel} grants nothing and was dropped`,
        });
        return;
      }
      const soleCourseId = item.courses.length === 1 ? item.courses[0] : undefined;
      if (soleCourseId !== undefined) {
        pushMigrated(
          {
            courseId: soleCourseId,
            courseLevelAccess: false,
            moduleIds: item.courseModules,
            lessonIds: [],
          },
          itemLabel,
        );
        return;
      }
      const { byCourse, unassigned } = partitionByCourse(
        item.courseModules,
        item.courses,
        (moduleId) => lookups.courseIdsByModuleId.get(moduleId) ?? new Set<string>(),
      );
      for (const [courseId, moduleIds] of byCourse) {
        pushMigrated({ courseId, courseLevelAccess: false, moduleIds, lessonIds: [] }, itemLabel);
      }
      for (const moduleId of unassigned) {
        anomalies.push({
          kind: 'module-outside-item-courses',
          subject,
          detail: `item ${itemLabel}: module ${moduleId} belongs to none of the item courses and was dropped`,
        });
      }
      return;
    }
    if (item.courseLessons.length > 0) {
      const soleCourseId = item.courses.length === 1 ? item.courses[0] : undefined;
      if (soleCourseId !== undefined) {
        pushMigrated(
          {
            courseId: soleCourseId,
            courseLevelAccess: false,
            moduleIds: [],
            lessonIds: item.courseLessons,
          },
          itemLabel,
        );
        return;
      }
      const { byCourse, unassigned } = partitionByCourse(
        item.courseLessons,
        item.courses,
        (lessonId) => lessonCourseIds(lessonId, lookups),
      );
      for (const [courseId, lessonIds] of byCourse) {
        pushMigrated({ courseId, courseLevelAccess: false, moduleIds: [], lessonIds }, itemLabel);
      }
      for (const lessonId of unassigned) {
        anomalies.push({
          kind: 'lesson-outside-item-courses',
          subject,
          detail: `item ${itemLabel}: lesson ${lessonId} belongs to none of the item courses and was dropped`,
        });
      }
      return;
    }
    anomalies.push({
      kind: 'degenerate-access-item',
      subject,
      detail: `item ${itemLabel} grants nothing and was dropped`,
    });
  });

  return { items, anomalies };
};

export const legacyUserSchema = z.object({
  _id: objectIdString,
  email: z.string().min(1),
  firstName: z.string().nullish(),
  lastName: z.string().nullish(),
  role: z.string().nullish(),
  salt: z.string().nullish(),
  hash: z.string().nullish(),
});

export type LegacyUser = z.infer<typeof legacyUserSchema>;

export interface ExportedUser {
  legacyId: string;
  email: string;
  name: string | null;
  payloadPasswordMarker: string | null;
  role: 'admin' | 'student';
}

export const transformUser = (
  legacy: LegacyUser,
): { user: ExportedUser; anomalies: Anomaly[] } => {
  const anomalies: Anomaly[] = [];
  const subject = `users/${legacy._id}`;
  const name =
    [legacy.firstName, legacy.lastName]
      .map((part) => part?.trim() ?? '')
      .filter((part) => part.length > 0)
      .join(' ') || null;
  const salt = legacy.salt ?? '';
  const hash = legacy.hash ?? '';
  const hasCredential = isPayloadLegacyCredential({ salt, hash });
  if (!hasCredential) {
    anomalies.push({
      kind: 'user-without-credential',
      subject,
      detail: 'user has no valid Payload PBKDF2 salt+hash; exported without a password marker',
    });
  }
  const role = legacy.role === 'admin' ? 'admin' : 'student';
  if (legacy.role !== 'admin' && legacy.role !== 'student') {
    anomalies.push({
      kind: 'user-role-backfilled',
      subject,
      detail: `role ${JSON.stringify(legacy.role ?? null)} backfilled to student`,
    });
  }
  return {
    user: {
      legacyId: legacy._id,
      email: legacy.email,
      name,
      payloadPasswordMarker: hasCredential ? toLegacyPasswordHash({ salt, hash }) : null,
      role,
    },
    anomalies,
  };
};

export const legacyProgressSchema = z.object({
  _id: objectIdString,
  user: objectIdString.nullish(),
  course: objectIdString.nullish(),
  lastViewedLesson: objectIdString.nullish(),
  lastViewedModule: objectIdString.nullish(),
  lastViewedChapter: z.string().nullish(),
  completedLessons: z.array(objectIdString).default([]),
  updatedAt: z.string().nullish(),
});

export type LegacyProgress = z.infer<typeof legacyProgressSchema>;

const uniqueCompletedLessons = (progress: LegacyProgress): string[] => [
  ...new Set(progress.completedLessons),
];

const richerProgress = (a: LegacyProgress, b: LegacyProgress): LegacyProgress => {
  const aCount = uniqueCompletedLessons(a).length;
  const bCount = uniqueCompletedLessons(b).length;
  if (aCount !== bCount) return aCount > bCount ? a : b;
  const aUpdated = a.updatedAt ?? '';
  const bUpdated = b.updatedAt ?? '';
  if (aUpdated !== bUpdated) return aUpdated > bUpdated ? a : b;
  return a._id > b._id ? a : b;
};

export const dedupeProgress = (
  docs: LegacyProgress[],
): { kept: LegacyProgress[]; anomalies: Anomaly[] } => {
  const anomalies: Anomaly[] = [];
  const byKey = new Map<string, LegacyProgress>();
  const order: string[] = [];
  for (const doc of docs) {
    if (doc.user === undefined || doc.user === null || doc.course === undefined || doc.course === null) {
      anomalies.push({
        kind: 'progress-missing-refs',
        subject: `user-progresses/${doc._id}`,
        detail: 'progress lacks a user or course reference and was dropped',
      });
      continue;
    }
    const key = `${doc.user}::${doc.course}`;
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, doc);
      order.push(key);
      continue;
    }
    const winner = richerProgress(existing, doc);
    const loser = winner === existing ? doc : existing;
    byKey.set(key, winner);
    anomalies.push({
      kind: 'duplicate-progress-deduped',
      subject: `user-progresses/${loser._id}`,
      detail: `duplicate progress for user ${doc.user} course ${doc.course}; kept ${winner._id}`,
    });
  }
  return { kept: order.flatMap((key) => byKey.get(key) ?? []), anomalies };
};

export const legacyChapterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  contents: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        courseLesson: objectIdString.nullish(),
      }),
    )
    .default([]),
});

export type LegacyChapter = z.infer<typeof legacyChapterSchema>;

export const transformChapters = (
  moduleId: string,
  chapters: LegacyChapter[],
): { chapters: Chapter[]; anomalies: Anomaly[] } => {
  const anomalies: Anomaly[] = [];
  const transformed = chapters.map((chapter) => ({
    id: chapter.id,
    name: chapter.name,
    contents: chapter.contents.flatMap((content) => {
      if (content.courseLesson === undefined || content.courseLesson === null) {
        anomalies.push({
          kind: 'chapter-content-without-lesson',
          subject: `course-modules/${moduleId}`,
          detail: `chapter ${chapter.id} content ${content.id} has no lesson and was dropped`,
        });
        return [];
      }
      return [{ id: content.id, name: content.name, lessonId: content.courseLesson }];
    }),
  }));
  return { chapters: transformed, anomalies };
};

export const legacyLessonContentSchema = z.object({
  id: z.string().nullish(),
  type: z.enum(['video', 'embed', 'pdf', 'link', 'html']),
  video: objectIdString.nullish(),
  embedLink: z.string().nullish(),
  pdf: objectIdString.nullish(),
  link: z.string().nullish(),
  linkDescription: z.string().nullish(),
  html: z.string().nullish(),
});

export type LegacyLessonContent = z.infer<typeof legacyLessonContentSchema>;

export interface VideoPointer {
  key: string;
  bunnyStreamVideoId: string | null | undefined;
  bunnyStreamCollectionId: string | null | undefined;
}

export interface PdfPointer {
  url: string | null | undefined;
  name: string | null | undefined;
}

export interface LessonContentLookups {
  videoById: ReadonlyMap<string, VideoPointer>;
  pdfById: ReadonlyMap<string, PdfPointer>;
  streamLibraryId?: string;
}

export const transformLessonContents = (
  lessonId: string,
  contents: LegacyLessonContent[],
  lookups: LessonContentLookups,
): { blocks: LessonBlock[]; anomalies: Anomaly[] } => {
  const anomalies: Anomaly[] = [];
  const subject = `course-lessons/${lessonId}`;
  const drop = (kind: string, detail: string): [] => {
    anomalies.push({ kind, subject, detail });
    return [];
  };
  const blocks = contents.flatMap((content, index): LessonBlock[] => {
    const label = content.id ?? `#${String(index)}`;
    switch (content.type) {
      case 'video': {
        if (content.video === undefined || content.video === null) {
          return drop('lesson-content-missing-ref', `video content ${label} has no video reference`);
        }
        const video = lookups.videoById.get(content.video);
        if (video === undefined) {
          return drop('dangling-video-ref', `content ${label} references missing video ${content.video}`);
        }
        if (video.bunnyStreamVideoId === undefined || video.bunnyStreamVideoId === null || video.bunnyStreamVideoId.length === 0) {
          return drop(
            'video-without-stream-id',
            `content ${label}: video ${content.video} has no bunnyStreamVideoId`,
          );
        }
        return [
          {
            type: 'video',
            storageKey: video.key,
            streamVideoId: video.bunnyStreamVideoId,
            ...(lookups.streamLibraryId === undefined
              ? {}
              : { streamLibraryId: lookups.streamLibraryId }),
            ...(video.bunnyStreamCollectionId !== undefined &&
            video.bunnyStreamCollectionId !== null &&
            video.bunnyStreamCollectionId.length > 0
              ? { streamCollectionId: video.bunnyStreamCollectionId }
              : {}),
          },
        ];
      }
      case 'embed': {
        if (content.embedLink === undefined || content.embedLink === null || content.embedLink.length === 0) {
          return drop('lesson-content-missing-ref', `embed content ${label} has no embedLink`);
        }
        return [{ type: 'embed', embedUrl: content.embedLink }];
      }
      case 'pdf': {
        if (content.pdf === undefined || content.pdf === null) {
          return drop('lesson-content-missing-ref', `pdf content ${label} has no pdf reference`);
        }
        const pdf = lookups.pdfById.get(content.pdf);
        if (pdf === undefined) {
          return drop('dangling-pdf-ref', `content ${label} references missing pdf ${content.pdf}`);
        }
        if (pdf.url === undefined || pdf.url === null || pdf.url.length === 0) {
          return drop('pdf-without-url', `content ${label}: pdf ${content.pdf} has no url`);
        }
        return [
          {
            type: 'pdf',
            pdfUrl: pdf.url,
            ...(pdf.name !== undefined && pdf.name !== null && pdf.name.length > 0
              ? { name: pdf.name }
              : {}),
          },
        ];
      }
      case 'link': {
        if (content.link === undefined || content.link === null || content.link.length === 0) {
          return drop('lesson-content-missing-ref', `link content ${label} has no url`);
        }
        return [
          {
            type: 'link',
            url: content.link,
            ...(content.linkDescription !== undefined &&
            content.linkDescription !== null &&
            content.linkDescription.length > 0
              ? { description: content.linkDescription }
              : {}),
          },
        ];
      }
      case 'html': {
        if (content.html === undefined || content.html === null || content.html.length === 0) {
          return drop('lesson-content-missing-ref', `html content ${label} has no html`);
        }
        return [{ type: 'html', html: content.html }];
      }
    }
  });
  return { blocks, anomalies };
};
