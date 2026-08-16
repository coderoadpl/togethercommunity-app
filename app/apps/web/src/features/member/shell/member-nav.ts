export type MemberNavEntry =
  | { kind: 'start' }
  | { kind: 'space'; spaceId: string }
  | { kind: 'course'; courseId: string }
  | { kind: 'products' }
  | { kind: 'account' };

/** Wave 3 flips this to '/start'; every "home" link routes through it. */
export const memberHomePath = (): '/my' => '/my';

const segmentsOf = (pathname: string): string[] =>
  pathname.split('/').filter((segment) => segment.length > 0).map(decodeURIComponent);

export const activeNavEntry = (pathname: string): MemberNavEntry | null => {
  if (pathname === memberHomePath()) return { kind: 'start' };
  const [first, second, third] = segmentsOf(pathname);
  if (first === 'community' && second !== undefined) return { kind: 'space', spaceId: second };
  if (first === 'my' && second === 'courses' && third !== undefined) {
    return { kind: 'course', courseId: third };
  }
  if (first === 'my' && second === 'products') return { kind: 'products' };
  if (first === 'account') return { kind: 'account' };
  return null;
};
