import { createHash } from 'node:crypto';

import { z } from 'zod';

import { normalizeEmail } from '#core/domain/index.js';
import type { TenantBundle } from '#adapters/db/importer.js';
import {
  legacyAccessItemSchema,
  legacyChapterSchema,
  legacyLessonContentSchema,
  legacyProgressSchema,
  legacyUserSchema,
  transformAccessItems,
  transformChapters,
  transformLessonContents,
  transformUser,
  type AccessItemLookups,
  type PdfPointer,
  type VideoPointer,
} from './legacy-transform.js';

const SELECTED_COURSE_NAMES = [
  'Kurs front-end od A do Z',
  'Programowanie – co musisz wiedzieć, zanim zaczniesz?',
] as const;

const SELECTED_ACCESS_NAMES = [
  'CR Full Course',
  'CR JS Basics',
  'Free preview',
] as const;

const PRODUCT_TITLES = new Map<string, string>([
  ['CR Full Course', 'Pełny kurs CodeRoad'],
  ['CR JS Basics', 'Podstawy JavaScript CodeRoad'],
  ['Free preview', 'Darmowy podgląd'],
]);

const AS_ACCESS_NAME = 'AS Full Course';
const S3_ORIGIN = 'https://app-coderoad-pl.s3.eu-central-1.amazonaws.com';
const objectIdString = z.string().regex(/^[0-9a-f]{24}$/iu);
const isoDate = z.string().datetime();

const courseSchema = z.object({
  _id: objectIdString,
  name: z.string().min(1),
  description: z.string().nullish(),
  modules: z.array(objectIdString).default([]),
  image: objectIdString.nullish(),
});

const moduleSchema = z.object({
  _id: objectIdString,
  title: z.string().min(1),
  prefix: z.string().nullish(),
  courses: z.array(objectIdString).default([]),
  chapters: z.array(legacyChapterSchema).default([]),
});

const lessonSchema = z.object({
  _id: objectIdString,
  name: z.string().min(1),
  courseModules: z.array(objectIdString).default([]),
  contents: z.array(legacyLessonContentSchema).default([]),
});

const videoSchema = z.object({
  _id: objectIdString,
  key: z.string().nullish(),
  bunnyStreamVideoId: z.string().nullish(),
  bunnyStreamCollectionId: z.string().nullish(),
});

const pdfSchema = z.object({
  _id: objectIdString,
  name: z.string().nullish(),
  filename: z.string().nullish(),
  prefix: z.string().nullish(),
});

const imageSchema = z.object({
  _id: objectIdString,
  filename: z.string().nullish(),
  prefix: z.string().nullish(),
});

const accessSchema = z.object({
  _id: objectIdString,
  name: z.string().min(1),
  items: z.array(legacyAccessItemSchema).default([]),
});

const enrollmentSchema = z.object({
  _id: objectIdString,
  user: objectIdString.nullish(),
  access: objectIdString.nullish(),
  startsAt: isoDate.nullish(),
  expiresAt: isoDate.nullish(),
});

export interface PayloadSourceCollections {
  courses: unknown[];
  modules: unknown[];
  lessons: unknown[];
  videos: unknown[];
  pdfs: unknown[];
  images: unknown[];
  accesses: unknown[];
  enrollments: unknown[];
  users: unknown[];
  progress: unknown[];
}

export interface MigrationSkip {
  entity: string;
  reason: string;
  count: number;
  samples: string[];
}

export interface RenewalMerge {
  memberLegacyId: string;
  productLegacyId: string;
  enrollmentLegacyIds: string[];
  startsAt: string;
  expiresAt: string;
}

export interface PayloadMigrationPlan {
  bundle: TenantBundle;
  sourceCounts: Record<string, number>;
  selectedCounts: Record<string, number>;
  blockCounts: Record<string, number>;
  skips: MigrationSkip[];
  renewalMerges: RenewalMerge[];
}

export class PayloadMigrationFailure extends Error {}

const parseAll = <Schema extends z.ZodTypeAny>(
  schema: Schema,
  rows: unknown[],
  collection: string,
): z.output<Schema>[] =>
  rows.map((row, index) => {
    const parsed = schema.safeParse(row);
    if (!parsed.success) {
      throw new PayloadMigrationFailure(
        `Invalid ${collection}[${String(index)}]: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  });

const requireNamedRows = <Row extends { name: string }>(
  rows: Row[],
  names: readonly string[],
  entity: string,
): Row[] =>
  names.map((name) => {
    const matches = rows.filter((row) => row.name === name);
    if (matches.length !== 1) {
      throw new PayloadMigrationFailure(
        `Expected exactly one ${entity} named ${JSON.stringify(name)}, found ${String(matches.length)}`,
      );
    }
    const row = matches[0];
    if (row === undefined) throw new PayloadMigrationFailure(`Missing ${entity} ${name}`);
    return row;
  });

const byId = <Row extends { _id: string }>(rows: Row[]): Map<string, Row> =>
  new Map(rows.map((row) => [row._id, row]));

const rowsForIds = <Row extends { _id: string }>(
  ids: string[],
  rows: ReadonlyMap<string, Row>,
  entity: string,
): Row[] =>
  ids.map((id) => {
    const row = rows.get(id);
    if (row === undefined) {
      throw new PayloadMigrationFailure(`${entity} ${id} is referenced but missing`);
    }
    return row;
  });

const s3Url = (prefix: string | null | undefined, filename: string | null | undefined): string | null => {
  if (prefix === undefined || prefix === null || filename === undefined || filename === null) {
    return null;
  }
  const path = [prefix, filename].map((part) => encodeURIComponent(part)).join('/');
  return `${S3_ORIGIN}/${path}`;
};

const addSkip = (
  skips: MigrationSkip[],
  entity: string,
  reason: string,
  ids: string[],
): void => {
  if (ids.length === 0) return;
  skips.push({ entity, reason, count: ids.length, samples: ids.slice(0, 5) });
};

interface GrantGroup {
  memberLegacyId: string;
  productLegacyId: string;
  rows: Array<z.infer<typeof enrollmentSchema>>;
}

const stableGrantLegacyId = (memberLegacyId: string, productLegacyId: string): string =>
  `payload-grant-${createHash('sha256')
    .update(`${memberLegacyId}:${productLegacyId}`)
    .digest('hex')
    .slice(0, 32)}`;

export const mergeEnrollmentRenewals = (
  groups: GrantGroup[],
): { grants: TenantBundle['grants']; merges: RenewalMerge[] } => {
  const grants: TenantBundle['grants'] = [];
  const merges: RenewalMerge[] = [];
  for (const group of groups) {
    const startsAt = group.rows
      .flatMap((row) => row.startsAt ?? [])
      .sort()
      .at(0);
    const expiresAt = group.rows
      .flatMap((row) => row.expiresAt ?? [])
      .sort()
      .at(-1);
    if (startsAt === undefined || expiresAt === undefined) continue;
    const enrollmentLegacyIds = group.rows.map((row) => row._id).sort();
    grants.push({
      legacyId: stableGrantLegacyId(group.memberLegacyId, group.productLegacyId),
      memberLegacyId: group.memberLegacyId,
      productLegacyId: group.productLegacyId,
      startsAt,
      expiresAt,
    });
    if (group.rows.length > 1) {
      merges.push({
        memberLegacyId: group.memberLegacyId,
        productLegacyId: group.productLegacyId,
        enrollmentLegacyIds,
        startsAt,
        expiresAt,
      });
    }
  }
  return { grants, merges };
};

export const buildPayloadMigrationPlan = (
  source: PayloadSourceCollections,
): PayloadMigrationPlan => {
  const courses = parseAll(courseSchema, source.courses, 'courses');
  const modules = parseAll(moduleSchema, source.modules, 'course-modules');
  const lessons = parseAll(lessonSchema, source.lessons, 'course-lessons');
  const videos = parseAll(videoSchema, source.videos, 'video-files');
  const pdfs = parseAll(pdfSchema, source.pdfs, 'pdf-files');
  const images = parseAll(imageSchema, source.images, 'course-images');
  const accesses = parseAll(accessSchema, source.accesses, 'accesses');
  const enrollments = parseAll(enrollmentSchema, source.enrollments, 'enrollments');
  const users = parseAll(legacyUserSchema, source.users, 'users');
  const progress = parseAll(legacyProgressSchema, source.progress, 'user-progresses');
  const skips: MigrationSkip[] = [];

  const selectedCourses = requireNamedRows(
    courses,
    SELECTED_COURSE_NAMES,
    'course',
  );
  const selectedCourseIds = new Set(selectedCourses.map((course) => course._id));
  addSkip(
    skips,
    'courses',
    'outside owner-selected CodeRoad scope',
    courses.filter((course) => !selectedCourseIds.has(course._id)).map((course) => course._id),
  );

  const moduleRowsById = byId(modules);
  const selectedModuleIds = [...new Set(selectedCourses.flatMap((course) => course.modules))];
  const selectedModules = rowsForIds(selectedModuleIds, moduleRowsById, 'course-module');
  const selectedModuleIdSet = new Set(selectedModuleIds);
  addSkip(
    skips,
    'modules',
    'belongs only to an excluded course',
    modules.filter((module) => !selectedModuleIdSet.has(module._id)).map((module) => module._id),
  );

  const lessonRowsById = byId(lessons);
  const selectedLessonIds = [
    ...new Set(
      selectedModules.flatMap((module) =>
        module.chapters.flatMap((chapter) =>
          chapter.contents.flatMap((content) => content.courseLesson ?? []),
        ),
      ),
    ),
  ];
  const selectedLessons = rowsForIds(selectedLessonIds, lessonRowsById, 'course-lesson');
  const selectedLessonIdSet = new Set(selectedLessonIds);
  addSkip(
    skips,
    'lessons',
    'belongs only to an excluded course',
    lessons.filter((lesson) => !selectedLessonIdSet.has(lesson._id)).map((lesson) => lesson._id),
  );

  const courseIdsByModuleId = new Map<string, Set<string>>();
  for (const course of selectedCourses) {
    for (const moduleId of course.modules) {
      const ownerIds = courseIdsByModuleId.get(moduleId) ?? new Set<string>();
      ownerIds.add(course._id);
      courseIdsByModuleId.set(moduleId, ownerIds);
    }
  }
  const moduleIdsByLessonId = new Map<string, Set<string>>();
  for (const module of selectedModules) {
    for (const chapter of module.chapters) {
      for (const content of chapter.contents) {
        if (content.courseLesson === undefined || content.courseLesson === null) continue;
        const ownerIds = moduleIdsByLessonId.get(content.courseLesson) ?? new Set<string>();
        ownerIds.add(module._id);
        moduleIdsByLessonId.set(content.courseLesson, ownerIds);
      }
    }
  }

  const imageById = byId(images);
  const bundleCourses = selectedCourses.map((course) => {
    const image = course.image === undefined || course.image === null
      ? null
      : imageById.get(course.image);
    if (course.image !== undefined && course.image !== null && image === undefined) {
      throw new PayloadMigrationFailure(`Course ${course._id} references missing image ${course.image}`);
    }
    const imageUrl = image === null || image === undefined
      ? null
      : s3Url(image.prefix, image.filename);
    if (image !== null && image !== undefined && imageUrl === null) {
      throw new PayloadMigrationFailure(`Course image ${image._id} has no S3 object key`);
    }
    return {
      legacyId: course._id,
      name: course.name,
      description: course.description ?? '',
      imageUrl,
      moduleOrder: course.modules,
    };
  });

  const bundleModules = selectedModules.map((module) => {
    const transformed = transformChapters(module._id, module.chapters);
    if (transformed.anomalies.length > 0) {
      throw new PayloadMigrationFailure(
        `Module ${module._id} has invalid chapter references: ${JSON.stringify(transformed.anomalies)}`,
      );
    }
    return {
      legacyId: module._id,
      courseLegacyIds: [...(courseIdsByModuleId.get(module._id) ?? [])],
      title: module.title,
      prefix: module.prefix ?? null,
      chapters: transformed.chapters,
    };
  });

  const videoById = new Map<string, VideoPointer>();
  for (const video of videos) {
    const key = video.key ?? '';
    if (key.length === 0) continue;
    videoById.set(video._id, {
      key,
      bunnyStreamVideoId: video.bunnyStreamVideoId,
      bunnyStreamCollectionId: video.bunnyStreamCollectionId,
    });
  }
  const pdfById = new Map<string, PdfPointer>();
  for (const pdf of pdfs) {
    pdfById.set(pdf._id, {
      url: s3Url(pdf.prefix, pdf.filename),
      name: pdf.name ?? pdf.filename,
    });
  }
  const bundleLessons = selectedLessons.map((lesson) => {
    const transformed = transformLessonContents(lesson._id, lesson.contents, {
      videoById,
      pdfById,
    });
    if (transformed.anomalies.length > 0) {
      throw new PayloadMigrationFailure(
        `Lesson ${lesson._id} has invalid content: ${JSON.stringify(transformed.anomalies)}`,
      );
    }
    return { legacyId: lesson._id, name: lesson.name, contents: transformed.blocks };
  });

  const selectedAccesses = requireNamedRows(accesses, SELECTED_ACCESS_NAMES, 'access');
  const selectedAccessIds = new Set(selectedAccesses.map((access) => access._id));
  const asAccessIds = new Set(
    accesses.filter((access) => access.name === AS_ACCESS_NAME).map((access) => access._id),
  );
  addSkip(
    skips,
    'products',
    'excluded access package',
    accesses.filter((access) => !selectedAccessIds.has(access._id)).map((access) => access._id),
  );
  const accessLookups: AccessItemLookups = { courseIdsByModuleId, moduleIdsByLessonId };
  const bundleProducts = selectedAccesses.map((access) => {
    const transformed = transformAccessItems(access._id, access.items, accessLookups);
    const accessItems = transformed.items.filter((item) => selectedCourseIds.has(item.courseId));
    if (transformed.anomalies.length > 0 || accessItems.length !== transformed.items.length) {
      throw new PayloadMigrationFailure(
        `Access ${access._id} has invalid or excluded items: ${JSON.stringify(transformed.anomalies)}`,
      );
    }
    const title = PRODUCT_TITLES.get(access.name);
    if (title === undefined) throw new PayloadMigrationFailure(`No product title for ${access.name}`);
    return { legacyId: access._id, title, accessItems };
  });

  const enrollmentsByUser = new Map<string, Array<z.infer<typeof enrollmentSchema>>>();
  for (const enrollment of enrollments) {
    if (enrollment.user === undefined || enrollment.user === null) continue;
    const rows = enrollmentsByUser.get(enrollment.user) ?? [];
    rows.push(enrollment);
    enrollmentsByUser.set(enrollment.user, rows);
  }
  const solelyAsUserIds = new Set(
    users.flatMap((user) => {
      const rows = enrollmentsByUser.get(user._id) ?? [];
      return rows.length > 0 && rows.every((row) => row.access !== undefined && row.access !== null && asAccessIds.has(row.access))
        ? [user._id]
        : [];
    }),
  );
  addSkip(skips, 'users', 'clearly linked only to the excluded AS course', [...solelyAsUserIds]);
  const selectedUsers = users.filter((user) => !solelyAsUserIds.has(user._id));
  const bundleUsers = selectedUsers.map((sourceUser) => {
    const transformed = transformUser(sourceUser);
    if (transformed.anomalies.some((anomaly) => anomaly.kind === 'user-without-credential')) {
      addSkip(skips, 'credentials', 'malformed Payload PBKDF2 row; set-password fallback required', [sourceUser._id]);
    }
    const email = z.string().email().parse(normalizeEmail(transformed.user.email));
    return { ...transformed.user, email };
  });
  const duplicateEmails = bundleUsers
    .filter((user, index, rows) => rows.findIndex((entry) => entry.email === user.email) !== index)
    .map((user) => user.email);
  if (duplicateEmails.length > 0) {
    throw new PayloadMigrationFailure(
      `Duplicate normalized user emails: ${JSON.stringify([...new Set(duplicateEmails)])}`,
    );
  }
  const selectedUserIds = new Set(bundleUsers.map((user) => user.legacyId));
  const bundleMembers = bundleUsers.map((sourceUser) => ({
    legacyId: sourceUser.legacyId,
    email: sourceUser.email,
    displayName: sourceUser.name,
  }));

  addSkip(
    skips,
    'enrollments',
    'references an excluded access package',
    enrollments
      .filter((enrollment) => enrollment.access !== undefined && enrollment.access !== null && !selectedAccessIds.has(enrollment.access))
      .map((enrollment) => enrollment._id),
  );
  const invalidEnrollmentIds: string[] = [];
  const grantGroupsByPair = new Map<string, GrantGroup>();
  for (const enrollment of enrollments) {
    if (enrollment.access === undefined || enrollment.access === null || !selectedAccessIds.has(enrollment.access)) {
      continue;
    }
    if (
      enrollment.user === undefined ||
      enrollment.user === null ||
      !selectedUserIds.has(enrollment.user) ||
      enrollment.startsAt === undefined ||
      enrollment.startsAt === null ||
      enrollment.expiresAt === undefined ||
      enrollment.expiresAt === null
    ) {
      invalidEnrollmentIds.push(enrollment._id);
      continue;
    }
    const pair = `${enrollment.user}:${enrollment.access}`;
    const group = grantGroupsByPair.get(pair) ?? {
      memberLegacyId: enrollment.user,
      productLegacyId: enrollment.access,
      rows: [],
    };
    group.rows.push(enrollment);
    grantGroupsByPair.set(pair, group);
  }
  addSkip(
    skips,
    'enrollments',
    'dangling user or malformed grant window',
    invalidEnrollmentIds,
  );
  const mergedGrants = mergeEnrollmentRenewals([...grantGroupsByPair.values()]);

  const validChapterIds = new Set(
    bundleModules.flatMap((module) => module.chapters.map((chapter) => chapter.id)),
  );
  const invalidProgressIds: string[] = [];
  const bundleProgress = progress.flatMap((row): TenantBundle['progress'] => {
    if (
      row.user === undefined ||
      row.user === null ||
      !selectedUserIds.has(row.user) ||
      row.course === undefined ||
      row.course === null ||
      !selectedCourseIds.has(row.course)
    ) {
      invalidProgressIds.push(row._id);
      return [];
    }
    const completedLessonIds = [...new Set(row.completedLessons)].filter((id) =>
      selectedLessonIdSet.has(id),
    );
    return [{
      legacyId: row._id,
      userLegacyId: row.user,
      courseLegacyId: row.course,
      lastViewedLessonId:
        row.lastViewedLesson !== undefined &&
        row.lastViewedLesson !== null &&
        selectedLessonIdSet.has(row.lastViewedLesson)
          ? row.lastViewedLesson
          : null,
      lastViewedModuleId:
        row.lastViewedModule !== undefined &&
        row.lastViewedModule !== null &&
        selectedModuleIdSet.has(row.lastViewedModule)
          ? row.lastViewedModule
          : null,
      lastViewedChapterId:
        row.lastViewedChapter !== undefined &&
        row.lastViewedChapter !== null &&
        validChapterIds.has(row.lastViewedChapter)
          ? row.lastViewedChapter
          : null,
      completedLessonIds,
      updatedAt: row.updatedAt ?? null,
    }];
  });
  addSkip(
    skips,
    'progress',
    'dangling user or excluded course reference',
    invalidProgressIds,
  );

  const bundle: TenantBundle = {
    users: bundleUsers,
    courses: bundleCourses,
    modules: bundleModules,
    lessons: bundleLessons,
    products: bundleProducts,
    members: bundleMembers,
    grants: mergedGrants.grants,
    progress: bundleProgress,
  };
  const blockCounts: Record<string, number> = {};
  for (const lesson of bundle.lessons) {
    for (const block of lesson.contents) {
      blockCounts[block.type] = (blockCounts[block.type] ?? 0) + 1;
    }
  }
  return {
    bundle,
    sourceCounts: {
      courses: courses.length,
      modules: modules.length,
      lessons: lessons.length,
      videos: videos.length,
      pdfs: pdfs.length,
      images: images.length,
      accesses: accesses.length,
      enrollments: enrollments.length,
      users: users.length,
      progress: progress.length,
    },
    selectedCounts: {
      courses: bundle.courses.length,
      modules: bundle.modules.length,
      lessons: bundle.lessons.length,
      products: bundle.products.length,
      users: bundle.users.length,
      members: bundle.members.length,
      enrollmentRows: [...grantGroupsByPair.values()].reduce(
        (count, group) => count + group.rows.length,
        0,
      ),
      grants: bundle.grants.length,
      progress: bundle.progress.length,
    },
    blockCounts,
    skips,
    renewalMerges: mergedGrants.merges,
  };
};
