import { describe, expect, it } from 'vitest';

import type { AccessItem } from '#core/domain/index.js';

import { fanoutThreadReach } from './fanout-eligibility.js';
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

describe('fanoutThreadReach on a lesson of a module that two courses share', () => {
  it('reaches a member whose item for another course of the module grants it whole, in that course', () => {
    expect(fanoutThreadReach(access([
      { level: 'course', courseId: 'c1', excludedModuleIds: ['m-shared'] },
      { level: 'course', courseId: 'c2' },
    ]), lessonThread)).toEqual({ courseId: 'c2' });
  });

  it('keeps the first course for a member it opens the lesson for', () => {
    expect(fanoutThreadReach(access([{ level: 'course', courseId: 'c2' }, { level: 'course', courseId: 'c1' }]), lessonThread)).toEqual({ courseId: 'c1' });
  });

  it('skips a member whose only item excludes the module', () => {
    expect(fanoutThreadReach(access([{ level: 'course', courseId: 'c1', excludedModuleIds: ['m-shared'] }]), lessonThread)).toBeNull();
  });

  it('skips a lesson thread whose lesson sits in no course', () => {
    expect(fanoutThreadReach(access([{ level: 'course', courseId: 'c1' }]), { ...lessonThread, lessonLocations: [] })).toBeNull();
  });
});
