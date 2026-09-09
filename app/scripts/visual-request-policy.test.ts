import { describe, expect, it } from 'vitest';
import { API_PATHS } from '#core/contract/index.js';
import { fixtureClient, selectFixture } from '../apps/web/src/stories/fixture-client.js';
import { fixtureKey } from '../apps/web/src/stories/fixture-key.js';
import { visualRequestPolicy } from './visual-request-policy.js';

describe('shared visual request policy', () => {
  it('aborts mount mutations before allowing local requests and stubs only external images', () => {
    expect(visualRequestPolicy(new URL(`http://studio.localhost${API_PATHS.studentLastViewed}`), 'fetch')).toBe('abort');
    expect(visualRequestPolicy(new URL(`http://studio.localhost${API_PATHS.spaceSeen.replace(':spaceId', 'space-studio-community')}`), 'fetch')).toBe('abort');
    expect(visualRequestPolicy(new URL('http://studio.localhost/api/me'), 'fetch')).toBe('continue');
    expect(visualRequestPolicy(new URL('https://www.gravatar.com/avatar/test'), 'image')).toBe('placeholder');
    expect(visualRequestPolicy(new URL('https://images.example.test/test.png'), 'image')).toBe('placeholder');
    expect(visualRequestPolicy(new URL('https://video.example.test/embed'), 'document')).toBe('abort');
  });

  it('returns the real client transport failure even if a fixture contains mutation success', async () => {
    const input = { courseId: 'course-js', lessonId: 'lesson-js-variables-1', moduleId: 'module-js-basics', chapterId: 'chapter-js-variables' };
    selectFixture({ scenario: 'transport-policy', principal: 'student.active@together.dev', tenant: 'studio', route: '/', calls: {
      [fixtureKey('updateLastViewed', [input])]: { ok: true, value: {} },
      [fixtureKey('markSpaceSeen', [{ spaceId: 'space-studio-community' }])]: { ok: true, value: {} },
    } });
    const lastViewed = await fixtureClient.updateLastViewed(input);
    expect(lastViewed).toMatchObject({ ok: false, error: { code: 'internal', message: `Network error calling ${API_PATHS.studentLastViewed}: TypeError: Failed to fetch` } });
    expect(await fixtureClient.markSpaceSeen({ spaceId: 'space-studio-community' })).toMatchObject({ ok: false, error: { code: 'internal' } });
  });
});
