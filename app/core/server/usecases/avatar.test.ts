import { describe, expect, it } from 'vitest';

import { avatarUrlFor } from './avatar.js';

describe('avatarUrlFor', () => {
  it('returns the stored account image', () => {
    expect(avatarUrlFor('/api/public/assets/avatar/00000000-0000-4000-8000-000000000001.webp'))
      .toBe('/api/public/assets/avatar/00000000-0000-4000-8000-000000000001.webp');
  });

  it('does not expose a legacy external provider URL', () => {
    expect(avatarUrlFor('https://lh3.googleusercontent.com/a/photo')).toBeNull();
  });

  it('does not expose another host through a protocol-relative path', () => {
    expect(avatarUrlFor('//courses.example.org/avatar.webp')).toBeNull();
  });

  it('returns null so clients render initials when the image is absent', () => {
    expect(avatarUrlFor(null)).toBeNull();
  });
});
