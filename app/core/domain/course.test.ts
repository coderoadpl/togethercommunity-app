import { describe, expect, it } from 'vitest';

import {
  courseSchema,
  lessonBlockSchema,
  newCourseSchema,
  updateCourseInputSchema,
  VIDEO_EMBED_URL_MESSAGE,
} from './course.js';

describe('course image URLs', () => {
  it('accepts root-relative image paths on stored, create, and update schemas', () => {
    const imageUrl = '/api/public/assets/course-cover/00000000-0000-4000-8000-000000000001.jpg';

    expect(courseSchema.safeParse({
      id: 'course-1',
      tenantId: 'tenant-1',
      name: 'Course',
      description: '',
      imageUrl,
      moduleOrder: [],
      legacyId: null,
      createdAt: '2026-08-16T12:00:00.000Z',
    }).success).toBe(true);
    expect(newCourseSchema.safeParse({ name: 'Course', imageUrl }).success).toBe(true);
    expect(updateCourseInputSchema.safeParse({ id: 'course-1', imageUrl }).success).toBe(true);
  });
});

describe('lesson video embed URLs', () => {
  it.each([
    ['YouTube watch', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    ['YouTube short link', 'https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    ['YouTube Shorts', 'https://youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    ['YouTube live', 'https://www.youtube.com/live/jfKfPfyJRdk', 'https://www.youtube-nocookie.com/embed/jfKfPfyJRdk'],
    ['YouTube embed', 'https://youtube.com/embed/dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    [
      'YouTube watch inside a playlist',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc&index=3',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    ],
    ['Vimeo watch', 'https://vimeo.com/76979871', 'https://player.vimeo.com/video/76979871'],
    ['Vimeo channel', 'https://vimeo.com/channels/staffpicks/76979871', 'https://player.vimeo.com/video/76979871'],
    ['Vimeo group', 'https://vimeo.com/groups/motion/videos/76979871', 'https://player.vimeo.com/video/76979871'],
    [
      'Vimeo unlisted',
      'https://vimeo.com/76979871/5e2d1c1e6d',
      'https://player.vimeo.com/video/76979871?h=5e2d1c1e6d',
    ],
    [
      'Vimeo shorter unlisted hash',
      'https://vimeo.com/76979871?h=abc123',
      'https://player.vimeo.com/video/76979871?h=abc123',
    ],
    [
      'Vimeo embed',
      'https://player.vimeo.com/video/76979871?h=5e2d1c1e6d',
      'https://player.vimeo.com/video/76979871?h=5e2d1c1e6d',
    ],
  ])('normalizes a %s URL', (_name, input, expected) => {
    expect(lessonBlockSchema.parse({ type: 'embed', embedUrl: input })).toEqual({
      type: 'embed',
      embedUrl: expected,
    });
  });

  it.each([
    ['https://youtube.com/watch', VIDEO_EMBED_URL_MESSAGE.youtube],
    ['https://youtu.be/not-an-id', VIDEO_EMBED_URL_MESSAGE.youtube],
    ['https://www.youtube.com/embed/videoseries?list=PLabc', VIDEO_EMBED_URL_MESSAGE.youtube],
    ['https://vimeo.com/76979871/not-a-hash', VIDEO_EMBED_URL_MESSAGE.vimeo],
    ['https://player.vimeo.com/video/not-a-number', VIDEO_EMBED_URL_MESSAGE.vimeo],
    ['javascript:alert(1)', VIDEO_EMBED_URL_MESSAGE.url],
  ])('rejects a malformed provider URL: %s', (embedUrl, message) => {
    const parsed = lessonBlockSchema.safeParse({ type: 'embed', embedUrl });

    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.message).toBe(message);
  });

  it('keeps a valid generic legacy embed unchanged', () => {
    expect(lessonBlockSchema.parse({ type: 'embed', embedUrl: 'https://codesandbox.io/embed/example' })).toEqual({
      type: 'embed',
      embedUrl: 'https://codesandbox.io/embed/example',
    });
  });
});
