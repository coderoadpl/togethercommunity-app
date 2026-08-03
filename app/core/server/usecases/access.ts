import type {
  AccessItem,
  AccessStatus,
  CompletionStatus,
  Course,
  CourseLesson,
  CourseModule,
  CourseStructureWithAccess,
  Product,
} from '#core/domain/index.js';

/**
 * Access resolution + course-tree computation, kept as pure functions so the
 * use-cases stay thin and the 3-tier semantics are unit-tested in isolation.
 */

export interface AccessLookup {
  courseLevel: Set<string>;
  excludedModuleIds: Set<string>;
  moduleIds: Set<string>;
  lessonIds: Set<string>;
}

export const aggregateAccessItems = (products: Product[]): AccessItem[] =>
  products.flatMap((product) => product.accessItems);

const intersect = (a: Set<string>, b: Set<string>): Set<string> => {
  const out = new Set<string>();
  for (const id of a) if (b.has(id)) out.add(id);
  return out;
};

export const buildAccessLookup = (items: AccessItem[]): AccessLookup => {
  const courseLevel = new Set<string>();
  const moduleIds = new Set<string>();
  const lessonIds = new Set<string>();
  const perCourseExclusions = new Map<string, Set<string>>();

  for (const item of items) {
    if (item.level === 'course') {
      courseLevel.add(item.courseId);
      const excluded = new Set(item.excludedModuleIds ?? []);
      const current = perCourseExclusions.get(item.courseId);
      perCourseExclusions.set(item.courseId, current ? intersect(current, excluded) : excluded);
    } else if (item.level === 'modules') {
      for (const moduleId of item.moduleIds) moduleIds.add(moduleId);
    } else {
      for (const lessonId of item.lessonIds) lessonIds.add(lessonId);
    }
  }

  const excludedModuleIds = new Set<string>();
  for (const excluded of perCourseExclusions.values()) {
    for (const moduleId of excluded) if (!moduleIds.has(moduleId)) excludedModuleIds.add(moduleId);
  }

  return { courseLevel, excludedModuleIds, moduleIds, lessonIds };
};

/** A lookup that grants everything within a single course (staff / owner view). */
export const fullCourseLookup = (courseId: string): AccessLookup => ({
  courseLevel: new Set([courseId]),
  excludedModuleIds: new Set(),
  moduleIds: new Set(),
  lessonIds: new Set(),
});

const courseGrantsModule = (lookup: AccessLookup, courseId: string, moduleId: string): boolean =>
  lookup.courseLevel.has(courseId) && !lookup.excludedModuleIds.has(moduleId);

export const isLessonAccessibleByLookup = (
  lookup: AccessLookup,
  location: { courseId: string; moduleId: string; lessonId: string },
): boolean =>
  courseGrantsModule(lookup, location.courseId, location.moduleId) ||
  lookup.moduleIds.has(location.moduleId) ||
  lookup.lessonIds.has(location.lessonId);

const rollUpAccess = (statuses: AccessStatus[]): AccessStatus => {
  if (statuses.length === 0) return 'not-accessible';
  if (statuses.every((status) => status === 'fully-accessible')) return 'fully-accessible';
  if (statuses.every((status) => status === 'not-accessible')) return 'not-accessible';
  return 'partially-accessible';
};

const rollUpCompletion = (statuses: CompletionStatus[]): CompletionStatus => {
  if (statuses.length === 0) return 'not-completed';
  if (statuses.every((status) => status === 'fully-completed')) return 'fully-completed';
  if (statuses.every((status) => status === 'not-completed')) return 'not-completed';
  return 'partially-completed';
};

const byModuleOrder = (a: CourseModule, b: CourseModule): number =>
  a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt);

/**
 * Modules attached to a course, ordered by the course's explicit `moduleOrder`
 * (staff-controlled), with any module missing from that list falling back to
 * creation order at the end — so a freshly attached module is stable until it
 * is positioned.
 */
export const modulesForCourse = (course: Course, modules: CourseModule[]): CourseModule[] => {
  const rank = new Map(course.moduleOrder.map((moduleId, index) => [moduleId, index]));
  return modules
    .filter((module) => module.courseIds.includes(course.id))
    .sort((a, b) => {
      const rankA = rank.get(a.id) ?? Number.POSITIVE_INFINITY;
      const rankB = rank.get(b.id) ?? Number.POSITIVE_INFINITY;
      return rankA === rankB ? byModuleOrder(a, b) : rankA - rankB;
    });
};

export interface LinearContent {
  contentId: string;
  lessonId: string;
  moduleId: string;
  chapterId: string;
  name: string;
}

export const linearizeCourse = (
  course: Course,
  modules: CourseModule[],
  lessonsById: Map<string, CourseLesson>,
): LinearContent[] =>
  modulesForCourse(course, modules).flatMap((module) =>
    module.chapters.flatMap((chapter) =>
      chapter.contents.map((content) => ({
        contentId: content.id,
        lessonId: content.lessonId,
        moduleId: module.id,
        chapterId: chapter.id,
        name: lessonsById.get(content.lessonId)?.name ?? content.name,
      })),
    ),
  );

/** Location of a lesson within the course tree, deterministic across duplicates. */
export interface LessonLocation {
  course: Course;
  moduleId: string;
  chapterId: string;
}

export const locateLesson = (
  lessonId: string,
  courses: Course[],
  modules: CourseModule[],
): LessonLocation | null => {
  const orderedModules = [...modules].sort(byModuleOrder);
  for (const module of orderedModules) {
    for (const chapter of module.chapters) {
      const hit = chapter.contents.find((content) => content.lessonId === lessonId);
      if (!hit) continue;
      const course = module.courseIds
        .map((courseId) => courses.find((candidate) => candidate.id === courseId))
        .find((candidate): candidate is Course => candidate !== undefined);
      if (course) return { course, moduleId: module.id, chapterId: chapter.id };
    }
  }
  return null;
};

/**
 * The cheapest published product whose access items unlock the given lesson —
 * the one upsell target a locked row can honestly advertise.
 */
const cheapestUnlockingProduct = (
  publishedProducts: Product[],
  location: { courseId: string; moduleId: string; lessonId: string },
): Product | null => {
  let cheapestPaid: Product | null = null;
  let cheapestFree: Product | null = null;
  for (const product of publishedProducts) {
    const lookup = buildAccessLookup(product.accessItems);
    if (!isLessonAccessibleByLookup(lookup, location)) continue;
    if (product.priceCents > 0) {
      if (cheapestPaid === null || product.priceCents < cheapestPaid.priceCents) cheapestPaid = product;
    } else if (cheapestFree === null || product.priceCents < cheapestFree.priceCents) {
      cheapestFree = product;
    }
  }
  return cheapestPaid ?? cheapestFree;
};

export const buildCourseStructure = (
  course: Course,
  modules: CourseModule[],
  lessonsById: Map<string, CourseLesson>,
  lookup: AccessLookup,
  completedLessonIds: Set<string>,
  publishedProducts: Product[] = [],
): CourseStructureWithAccess => {
  const structureModules = modulesForCourse(course, modules).map((module) => {
    const moduleGranted =
      courseGrantsModule(lookup, course.id, module.id) || lookup.moduleIds.has(module.id);

    const structureChapters = module.chapters.map((chapter) => {
      const lessons = chapter.contents.map((content) => {
        const accessible =
          moduleGranted || lookup.lessonIds.has(content.lessonId);
        const unlockProduct = accessible
          ? null
          : cheapestUnlockingProduct(publishedProducts, {
              courseId: course.id,
              moduleId: module.id,
              lessonId: content.lessonId,
            });
        const durationMinutes = lessonsById.get(content.lessonId)?.durationMinutes;
        return {
          contentId: content.id,
          lessonId: content.lessonId,
          name: lessonsById.get(content.lessonId)?.name ?? content.name,
          accessStatus: accessible ? ('fully-accessible' as const) : ('not-accessible' as const),
          completionStatus: completedLessonIds.has(content.lessonId)
            ? ('fully-completed' as const)
            : ('not-completed' as const),
          ...(durationMinutes === undefined ? {} : { durationMinutes }),
          ...(unlockProduct === null ? {} : { unlockProductId: unlockProduct.id }),
        };
      });
      return {
        id: chapter.id,
        name: chapter.name,
        accessStatus: moduleGranted
          ? ('fully-accessible' as const)
          : rollUpAccess(lessons.map((lesson) => lesson.accessStatus)),
        completionStatus: rollUpCompletion(lessons.map((lesson) => lesson.completionStatus)),
        lessons,
      };
    });

    const moduleLessons = structureChapters.flatMap((chapter) => chapter.lessons);
    return {
      id: module.id,
      name: module.name,
      accessStatus: moduleGranted
        ? ('fully-accessible' as const)
        : rollUpAccess(moduleLessons.map((lesson) => lesson.accessStatus)),
      completionStatus: rollUpCompletion(moduleLessons.map((lesson) => lesson.completionStatus)),
      chapters: structureChapters,
    };
  });

  const allLessons = structureModules.flatMap((module) =>
    module.chapters.flatMap((chapter) => chapter.lessons),
  );
  return {
    courseId: course.id,
    name: course.name,
    accessStatus: rollUpAccess(structureModules.map((module) => module.accessStatus)),
    completionStatus: rollUpCompletion(allLessons.map((lesson) => lesson.completionStatus)),
    modules: structureModules,
  };
};
