import { describe, expect, it } from 'vitest';

import {
  postCreateInputSchema,
  postOutputSchema,
  postUpdateInputSchema,
  postsSearchOutputSchema,
} from './routes.js';

const publicPost = {
  id: 'post-1',
  tenantId: 'tenant-1',
  contextKind: 'space',
  contextId: 'space-1',
  parentPostId: null,
  rootPostId: 'post-1',
  authorDisplay: 'Author',
  authorIsStaff: false,
  body: '**Hello**',
  bodyFormat: 'markdown',
  bodyHtml: '<p><strong>Hello</strong></p>',
  bodyPlainText: 'Hello',
  createdAt: '2026-09-09T12:00:00.000Z',
  editedAt: null,
  deletedAt: null,
  pinnedAt: null,
  isOwn: false,
  authorAvatarUrl: null,
};

describe('post content contracts', () => {
  it('defaults legacy creates to plain text and leaves edit format unspecified', () => {
    expect(postCreateInputSchema.parse({
      contextKind: 'space',
      contextId: 'space-1',
      body: 'Legacy client',
    }).bodyFormat).toBe('plain');
    expect(postUpdateInputSchema.parse({ id: 'post-1', body: 'Legacy edit' }).bodyFormat).toBeUndefined();
  });

  it('accepts explicit Markdown mutations', () => {
    expect(postCreateInputSchema.parse({
      contextKind: 'space',
      contextId: 'space-1',
      body: '**Markdown**',
      bodyFormat: 'markdown',
    }).bodyFormat).toBe('markdown');
    expect(postUpdateInputSchema.parse({
      id: 'post-1',
      body: '*Edited*',
      bodyFormat: 'markdown',
    }).bodyFormat).toBe('markdown');
  });

  it('requires server-rendered HTML on post and search reads', () => {
    expect(postOutputSchema.parse({ post: publicPost }).post.bodyHtml).toContain('<strong>');
    expect(postsSearchOutputSchema.parse({
      hits: [{ post: publicPost, lessonId: 'space-1', snippet: 'Hello' }],
    }).hits[0]?.post.bodyFormat).toBe('markdown');
    expect(() => postOutputSchema.parse({ post: { ...publicPost, bodyHtml: undefined } })).toThrow();
  });
});
