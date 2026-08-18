export type MemberNavEntry =
  | { kind: 'start' }
  | { kind: 'search' }
  | { kind: 'messages' }
  | { kind: 'space'; spaceId: string }
  | { kind: 'course'; courseId: string }
  | { kind: 'products' }
  | { kind: 'account' };

export interface CourseContext {
  courseId: string;
  lessonId: string | null;
}

export const memberHomePath = (): '/start' => '/start';

export const anonHomePath = (): '/' => '/';

export const memberSearchPath = (): '/search' => '/search';

export const memberMessagesPath = (): '/messages' => '/messages';

const segmentsOf = (pathname: string): string[] =>
  pathname.split('/').filter((segment) => segment.length > 0).map(decodeURIComponent);

export const courseContextFromPath = (pathname: string): CourseContext | null => {
  const [first, second, courseId, lessonsSegment, lessonId] = segmentsOf(pathname);
  if (first !== 'my' || second !== 'courses' || courseId === undefined) return null;
  return {
    courseId,
    lessonId: lessonsSegment === 'lessons' && lessonId !== undefined ? lessonId : null,
  };
};

export const activeNavEntry = (pathname: string): MemberNavEntry | null => {
  if (pathname === memberHomePath() || pathname === anonHomePath()) return { kind: 'start' };
  if (pathname === memberSearchPath()) return { kind: 'search' };
  const [first, second] = segmentsOf(pathname);
  if (first === 'messages') return { kind: 'messages' };
  if (first === 'community' && second !== undefined) return { kind: 'space', spaceId: second };
  if ((first === 'community' || first === 'my') && second === undefined) return { kind: 'start' };
  const course = courseContextFromPath(pathname);
  if (course !== null) return { kind: 'course', courseId: course.courseId };
  if (first === 'my' && second === 'products') return { kind: 'products' };
  if (first === 'account') return { kind: 'account' };
  return null;
};
