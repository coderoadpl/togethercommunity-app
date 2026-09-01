import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

export const secretEquals = (candidate: string | undefined, expected: string): boolean =>
  candidate !== undefined && timingSafeEqual(digest(candidate), digest(expected));
