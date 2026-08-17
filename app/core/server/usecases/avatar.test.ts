import { describe, expect, it } from 'vitest';

import type { ContentHash } from '../ports.js';
import { avatarUrlFor, gravatarUrl } from './avatar.js';

const contentHash: ContentHash = {
  sha256: (content) => `digest(${String(content)})`,
};

describe('gravatarUrl', () => {
  it('hashes the address and pins the 404 fallback and the rendered size', () => {
    expect(gravatarUrl(contentHash, 'ada@example.com')).toBe(
      'https://www.gravatar.com/avatar/digest(ada@example.com)?d=404&s=160',
    );
  });

  it('normalizes surrounding whitespace and letter case before hashing', () => {
    expect(gravatarUrl(contentHash, '  Ada@Example.COM ')).toBe(
      gravatarUrl(contentHash, 'ada@example.com'),
    );
  });

  it('derives a distinct hash for a tombstoned address', () => {
    expect(gravatarUrl(contentHash, 'deleted-member-1@anonymized.invalid')).not.toBe(
      gravatarUrl(contentHash, 'ada@example.com'),
    );
  });
});

describe('avatarUrlFor', () => {
  it('prefers the provider image over the gravatar fallback', () => {
    expect(avatarUrlFor(contentHash, {
      image: 'https://lh3.googleusercontent.com/a/photo',
      email: 'ada@example.com',
    })).toBe('https://lh3.googleusercontent.com/a/photo');
  });

  it('falls back to gravatar when the provider image is absent', () => {
    expect(avatarUrlFor(contentHash, { image: null, email: 'ada@example.com' })).toBe(
      gravatarUrl(contentHash, 'ada@example.com'),
    );
  });
});
