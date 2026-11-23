import { describe, expect, it } from 'vitest';

import type { AccessItem } from '#core/domain/index.js';

import { fanoutCanAccessThread } from './fanout-eligibility.js';
import type { ThreadContextInfo } from './thread-context.js';

const access = (accessItems: AccessItem[]) => ({
  userId: 'u1',
  member: null,
  isStaff: false,
  activeProductIds: ['p1'],
  accessItems,
});

const lessonThread: ThreadContextInfo = {
  space: null,
  lessonLocations: [
    { courseId: 'c1', moduleId: 'm-shared', lessonId: 'l1' },
    { courseId: 'c2', moduleId: 'm-shared', lessonId: 'l1' },
  ],
  courseId: 'c1',
  contextName: 'Lesson',
  contextUrl: 'https://acme.example/lesson',
};

describe('fanoutCanAccessThread on a lesson of a module that two courses share', () => {
  it('reaches a member whose item for another course of the module grants it whole', () => {
    expect(fanoutCanAccessThread(access([
      { level: 'course', courseId: 'c1', excludedModuleIds: ['m-shared'] },
      { level: 'course', courseId: 'c2' },
    ]), lessonThread)).toBe(true);
  });

  it('skips a member whose only item excludes the module', () => {
    expect(fanoutCanAccessThread(access([{ level: 'course', courseId: 'c1', excludedModuleIds: ['m-shared'] }]), lessonThread)).toBe(false);
  });

  it('skips a lesson thread whose lesson sits in no course', () => {
    expect(fanoutCanAccessThread(access([{ level: 'course', courseId: 'c1' }]), { ...lessonThread, lessonLocations: [] })).toBe(false);
  });
});
